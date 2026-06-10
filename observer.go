// RealSecCam Observer v1.4
// Zero-touch discovery agent. No external dependencies. Pure Go stdlib.
//
// Features:
// - Named NetworkInterface type (fixes v1.3 compile error)
// - Scans ALL non-loopback interfaces (not just the first one)
// - Auto-registers itself to start on boot
//   Windows: HKCU Run registry key
//   macOS:   ~/Library/LaunchAgents plist
//   Linux:   ~/.config/autostart desktop entry
// - Watchdog goroutine: silently restarts scanner if it hangs
// - Self-healing retry: up to 3 attempts per scan cycle
// - Writes observer-diag.json next to the binary for troubleshooting
// - Graceful shutdown on Ctrl+C
//
// Build:
//   Windows: GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-Windows.exe observer.go
//   macOS:   GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-macOS observer.go
//   Linux:   GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-Linux  observer.go

package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	Version              = "1.4.0"
	ReportURL            = "https://accelerated-sync-dev-flow.base44.app/functions/agentReport"
	ScanIntervalSec      = 30
	HeartbeatIntervalSec = 15
	PortScanTimeoutMs    = 800
	MaxConcurrentProbes  = 50
	WatchdogTimeoutSec   = 120
	MaxScanRetries       = 3
	DiagLogFile          = "observer-diag.json"
)

var CameraPorts = []int{554, 8554, 8080, 8000, 80, 443, 37777, 34567, 9000}

var OUITable = map[string]string{
	"00:23:63": "Hikvision", "bc:ad:28": "Hikvision", "4c:bd:8f": "Hikvision",
	"8c:e7:48": "Hikvision", "a0:8c:f8": "Hikvision", "c0:56:e3": "Hikvision",
	"54:c4:15": "Hikvision", "b4:a3:82": "Hikvision",
	"28:57:be": "Dahua",     "3c:ef:8c": "Dahua",     "e0:50:8b": "Dahua",
	"90:02:a9": "Dahua",     "bc:32:b2": "Dahua",     "a4:14:37": "Dahua",
	"c8:d5:fe": "Reolink",   "ec:71:db": "Reolink",   "d4:93:90": "Reolink",
	"e4:24:6c": "Reolink",   "00:6a:e2": "Reolink",
	"b0:c5:ca": "Wyze",      "2c:aa:8e": "Wyze",      "4c:ed:fb": "Wyze",
	"f4:f2:6d": "Amcrest",   "00:62:6e": "Foscam",    "9c:8e:cd": "TP-Link Tapo",
	"1c:61:b4": "Arlo",      "70:56:81": "Ring",       "b4:e6:2d": "Axis",
	"b8:a4:4f": "Hanwha",    "b0:be:76": "Eufy",       "5c:aa:fd": "Eufy",
	"00:80:f0": "Panasonic",  "00:1b:c5": "Bosch",     "00:30:48": "Pelco",
	"d8:d7:75": "Uniview",   "e8:26:89": "Uniview",    "2c:63:45": "Tiandy",
	"b8:27:eb": "Raspberry Pi", "dc:a6:32": "Raspberry Pi", "e4:5f:01": "Raspberry Pi",
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NetworkInterface struct {
	Name   string `json:"name"`
	IP     string `json:"ip"`
	MAC    string `json:"mac"`
	Subnet string `json:"subnet"`
}

type DiscoveredDevice struct {
	IP     string `json:"ip"`
	MAC    string `json:"mac"`
	Port   int    `json:"port"`
	Ports  []int  `json:"ports"`
	Brand  string `json:"brand"`
	SSID   string `json:"ssid"`
	Online bool   `json:"online"`
}

type HeartbeatPayload struct {
	Type string        `json:"type"`
	Data HeartbeatData `json:"data"`
}

type HeartbeatData struct {
	Agent        string `json:"agent"`
	Host         string `json:"host"`
	SSID         string `json:"ssid"`
	LocalIP      string `json:"local_ip"`
	LocalSubnet  string `json:"local_subnet"`
	CamerasFound int    `json:"cameras_found"`
	Version      string `json:"version"`
	Status       string `json:"status"`
}

type DiscoveryPayload struct {
	Type string            `json:"type"`
	Data []DiscoveredDevice `json:"data"`
}

type DiagnosticLog struct {
	Timestamp   string             `json:"timestamp"`
	Version     string             `json:"version"`
	Hostname    string             `json:"hostname"`
	SSID        string             `json:"ssid"`
	LocalIP     string             `json:"local_ip"`
	LocalSubnet string             `json:"local_subnet"`
	Interfaces  []NetworkInterface `json:"interfaces"`
	Devices     []DiscoveredDevice `json:"devices_found"`
	LastReport  string             `json:"last_report_status"`
	ScanCount   int64              `json:"scan_count"`
}

// ─── Globals ──────────────────────────────────────────────────────────────────

var (
	lastFound    atomic.Int64
	scanCount    atomic.Int64
	scannerAlive atomic.Int64
	diagMu       sync.Mutex
	diagLog      DiagnosticLog
	debugMode    bool
	onceMode     bool
)

func logf(format string, args ...interface{}) {
	fmt.Printf("["+time.Now().Format("15:04:05")+"] "+format+"\n", args...)
}

// ─── Network helpers ──────────────────────────────────────────────────────────

func getNetworkInterfaces() []NetworkInterface {
	result := []NetworkInterface{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return result
	}
	skipPat := []string{"lo", "loopback", "virtual", "vmware", "vbox", "docker",
		"tunnel", "tap", "tun", "bluetooth", "isatap", "teredo", "pseudo"}
	for _, iface := range ifaces {
		name := strings.ToLower(iface.Name)
		skipped := false
		for _, p := range skipPat {
			if strings.Contains(name, p) {
				skipped = true
				break
			}
		}
		if skipped || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			var mask net.IPMask
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
				mask = v.Mask
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}
			if ip.To4()[0] == 169 && ip.To4()[1] == 254 {
				continue
			}
			subnet := ""
			if mask != nil {
				ones, _ := mask.Size()
				parts := strings.Split(ip.String(), ".")
				subnet = fmt.Sprintf("%s.%s.%s.0/%d", parts[0], parts[1], parts[2], ones)
			}
			result = append(result, NetworkInterface{
				Name:   iface.Name,
				IP:     ip.String(),
				MAC:    iface.HardwareAddr.String(),
				Subnet: subnet,
			})
		}
	}
	return result
}

func getLocalIP() string {
	ifaces := getNetworkInterfaces()
	if len(ifaces) > 0 {
		return ifaces[0].IP
	}
	return ""
}

func getLocalSubnet() string {
	ifaces := getNetworkInterfaces()
	if len(ifaces) > 0 {
		return ifaces[0].Subnet
	}
	return ""
}

func getSSID() string {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("netsh", "wlan", "show", "interfaces").Output()
		if err != nil {
			return "(wired)"
		}
		for _, line := range strings.Split(string(out), "\n") {
			t := strings.TrimSpace(line)
			if strings.HasPrefix(t, "SSID") && !strings.HasPrefix(t, "BSSID") {
				if parts := strings.SplitN(t, ":", 2); len(parts) == 2 {
					return strings.TrimSpace(parts[1])
				}
			}
		}
	case "darwin":
		out, err := exec.Command("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport", "-I").Output()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				t := strings.TrimSpace(line)
				if strings.HasPrefix(t, "SSID:") {
					if parts := strings.SplitN(t, ":", 2); len(parts) == 2 {
						return strings.TrimSpace(parts[1])
					}
				}
			}
		}
	default:
		out, err := exec.Command("iwgetid", "-r").Output()
		if err == nil {
			if s := strings.TrimSpace(string(out)); s != "" {
				return s
			}
		}
		out, _ := exec.Command("sh", "-c", "nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2").Output()
		if s := strings.TrimSpace(string(out)); s != "" {
			return s
		}
	}
	return "(wired)"
}

func lookupOUI(mac string) string {
	if mac == "" {
		return ""
	}
	n := strings.ToLower(strings.ReplaceAll(mac, "-", ":"))
	if parts := strings.Split(n, ":"); len(parts) >= 3 {
		if brand, ok := OUITable[strings.Join(parts[:3], ":")]; ok {
			return brand
		}
	}
	return ""
}

func getARPTable() map[string]string {
	m := map[string]string{}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("arp", "-a")
	} else {
		cmd = exec.Command("sh", "-c", "arp -n 2>/dev/null || arp -a 2>/dev/null")
	}
	out, err := cmd.Output()
	if err != nil {
		return m
	}
	for _, line := range strings.Split(string(out), "\n") {
		var ip, mac string
		for _, f := range strings.Fields(line) {
			if net.ParseIP(f) != nil && strings.Contains(f, ".") {
				ip = f
			}
			if (strings.Count(f, ":") == 5 || strings.Count(f, "-") == 5) && len(f) >= 17 {
				mac = strings.ToLower(strings.ReplaceAll(f, "-", ":"))
			}
		}
		if ip != "" && mac != "" && mac != "ff:ff:ff:ff:ff:ff" {
			m[ip] = mac
		}
	}
	return m
}

// ─── Port scanning ────────────────────────────────────────────────────────────

func probePort(ip string, port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port),
		time.Duration(PortScanTimeoutMs)*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func probeDevice(ip string) *DiscoveredDevice {
	type res struct {
		port int
		open bool
	}
	results := make([]res, len(CameraPorts))
	var wg sync.WaitGroup
	for i, p := range CameraPorts {
		wg.Add(1)
		go func(idx, port int) {
			defer wg.Done()
			results[idx] = res{port, probePort(ip, port)}
		}(i, p)
	}
	wg.Wait()
	open := []int{}
	for _, r := range results {
		if r.open {
			open = append(open, r.port)
		}
	}
	if len(open) == 0 {
		return nil
	}
	return &DiscoveredDevice{IP: ip, Port: open[0], Ports: open}
}

func sweepSubnetBase(base string, arp map[string]string, ssid string) []DiscoveredDevice {
	ips := make([]string, 254)
	for i := range ips {
		ips[i] = fmt.Sprintf("%s.%d", base, i+1)
	}
	devices := []DiscoveredDevice{}
	for i := 0; i < len(ips); i += MaxConcurrentProbes {
		end := i + MaxConcurrentProbes
		if end > len(ips) {
			end = len(ips)
		}
		type br struct{ d *DiscoveredDevice }
		batch := make([]br, end-i)
		var wg sync.WaitGroup
		for j, ip := range ips[i:end] {
			wg.Add(1)
			go func(idx int, tip string) {
				defer wg.Done()
				batch[idx] = br{probeDevice(tip)}
			}(j, ip)
		}
		wg.Wait()
		for _, r := range batch {
			if r.d == nil {
				continue
			}
			mac := arp[r.d.IP]
			r.d.MAC = mac
			r.d.SSID = ssid
			r.d.Online = true
			if b := lookupOUI(mac); b != "" {
				r.d.Brand = b
			} else {
				r.d.Brand = "IP Camera"
			}
			devices = append(devices, *r.d)
		}
	}
	return devices
}

func sweepAllInterfaces() []DiscoveredDevice {
	ifaces := getNetworkInterfaces()
	if len(ifaces) == 0 {
		return nil
	}
	arp := getARPTable()
	ssid := getSSID()
	seen := map[string]bool{}
	all := []DiscoveredDevice{}
	for _, iface := range ifaces {
		parts := strings.Split(iface.IP, ".")
		if len(parts) < 3 {
			continue
		}
		base := strings.Join(parts[:3], ".")
		if seen[base] {
			continue
		}
		seen[base] = true
		logf("Sweeping %s.0/24 via %s", base, iface.Name)
		all = append(all, sweepSubnetBase(base, arp, ssid)...)
	}
	return all
}

// ─── Reporting ────────────────────────────────────────────────────────────────

func postJSON(payload interface{}) (string, error) {
	body, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("POST", ReportURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	buf.ReadFrom(resp.Body)
	return buf.String(), nil
}

func sendHeartbeat(camerasFound int) {
	h, _ := os.Hostname()
	_, err := postJSON(HeartbeatPayload{Type: "heartbeat", Data: HeartbeatData{
		Agent:        "discovery",
		Host:         h,
		SSID:         getSSID(),
		LocalIP:      getLocalIP(),
		LocalSubnet:  getLocalSubnet(),
		CamerasFound: camerasFound,
		Version:      Version,
		Status:       "running",
	}})
	if err != nil {
		logf("[HB] error: %v", err)
	} else {
		logf("[HB] sent cameras=%d", camerasFound)
	}
	diagMu.Lock()
	diagLog.LastReport = fmt.Sprintf("heartbeat cameras=%d", camerasFound)
	diagMu.Unlock()
}

func sendDiscovery(devices []DiscoveredDevice) {
	if len(devices) == 0 {
		return
	}
	r, err := postJSON(DiscoveryPayload{Type: "discovery", Data: devices})
	if err != nil {
		logf("[Discovery] error: %v", err)
	} else {
		logf("[Discovery] reported %d devices resp=%s", len(devices), r)
	}
	diagMu.Lock()
	diagLog.LastReport = fmt.Sprintf("discovery devices=%d", len(devices))
	diagMu.Unlock()
}

func writeDiag(devices []DiscoveredDevice) {
	h, _ := os.Hostname()
	diagMu.Lock()
	diagLog.Timestamp = time.Now().UTC().Format(time.RFC3339)
	diagLog.Version = Version
	diagLog.Hostname = h
	diagLog.SSID = getSSID()
	diagLog.LocalIP = getLocalIP()
	diagLog.LocalSubnet = getLocalSubnet()
	diagLog.Interfaces = getNetworkInterfaces()
	diagLog.Devices = devices
	diagLog.ScanCount = scanCount.Load()
	dataCopy := diagLog
	diagMu.Unlock()
	data, _ := json.MarshalIndent(dataCopy, "", "  ")
	exePath, _ := os.Executable()
	os.WriteFile(filepath.Join(filepath.Dir(exePath), DiagLogFile), data, 0644)
}

// ─── Auto-start ───────────────────────────────────────────────────────────────

func registerAutostart() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("reg", "add",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			"/v", "RealSecCamObserver", "/t", "REG_SZ", "/d", exePath, "/f")
		if cmd.Run() == nil {
			logf("[Autostart] Registered Windows startup registry")
		}
	case "darwin":
		plistPath := filepath.Join(os.Getenv("HOME"), "Library", "LaunchAgents", "com.realseccam.observer.plist")
		if _, err := os.Stat(plistPath); err == nil {
			return
		}
		plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.realseccam.observer</string>
  <key>ProgramArguments</key><array><string>%s</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>`, exePath)
		os.MkdirAll(filepath.Dir(plistPath), 0755)
		if os.WriteFile(plistPath, []byte(plist), 0644) == nil {
			exec.Command("launchctl", "load", "-w", plistPath).Run()
			logf("[Autostart] Registered macOS LaunchAgent")
		}
	default:
		dir := filepath.Join(os.Getenv("HOME"), ".config", "autostart")
		os.MkdirAll(dir, 0755)
		desktopPath := filepath.Join(dir, "realseccam-observer.desktop")
		if _, err := os.Stat(desktopPath); err == nil {
			return
		}
		content := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=RealSecCam Observer\nExec=%s\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n", exePath)
		if os.WriteFile(desktopPath, []byte(content), 0644) == nil {
			logf("[Autostart] Registered Linux XDG autostart")
		}
	}
}

// ─── Scanner + Watchdog ───────────────────────────────────────────────────────

func performScan() {
	ssid := getSSID()
	ip := getLocalIP()
	subnet := getLocalSubnet()
	logf("Scanning all interfaces  subnet=%s  ssid=%s  ip=%s", subnet, ssid, ip)

	var devices []DiscoveredDevice
	for attempt := 1; attempt <= MaxScanRetries; attempt++ {
		devices = sweepAllInterfaces()
		if len(devices) > 0 || attempt == MaxScanRetries {
			break
		}
		logf("Attempt %d found nothing, retrying in 5s...", attempt)
		time.Sleep(5 * time.Second)
	}

	logf("Found %d devices", len(devices))
	lastFound.Store(int64(len(devices)))
	scanCount.Add(1)
	writeDiag(devices)
	sendDiscovery(devices)
	sendHeartbeat(len(devices))
	scannerAlive.Store(time.Now().Unix())
}

func runScanner() {
	logf("Scanner started (sweep every %ds, heartbeat every %ds)", ScanIntervalSec, HeartbeatIntervalSec)
	sendHeartbeat(0)
	performScan()

	scanTick := time.NewTicker(ScanIntervalSec * time.Second)
	hbTick := time.NewTicker(HeartbeatIntervalSec * time.Second)
	defer scanTick.Stop()
	defer hbTick.Stop()

	for {
		select {
		case <-scanTick.C:
			performScan()
		case <-hbTick.C:
			sendHeartbeat(int(lastFound.Load()))
		}
	}
}

func runWatchdog() {
	scannerAlive.Store(time.Now().Unix())
	for range time.NewTicker(30 * time.Second).C {
		if time.Now().Unix()-scannerAlive.Load() > WatchdogTimeoutSec {
			logf("[Watchdog] Scanner hung — restarting")
			go runScanner()
			scannerAlive.Store(time.Now().Unix())
		}
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	flag.BoolVar(&debugMode, "debug", false, "Enable verbose output")
	flag.BoolVar(&onceMode, "once", false, "Run a single scan then exit")
	flag.Parse()

	h, _ := os.Hostname()
	logf("RealSecCam Observer v%s  host=%s  ip=%s  ssid=%s", Version, h, getLocalIP(), getSSID())
	logf("Reporting to: %s", ReportURL)

	registerAutostart()

	if onceMode {
		performScan()
		return
	}

	go runScanner()
	go runWatchdog()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	logf("Shutting down...")
}
