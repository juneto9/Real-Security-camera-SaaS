// RealSecCam Observer v2.4
// Zero-touch background discovery agent. Pure Go stdlib. No CGO. No external deps.
// NO VBScript, NO PowerShell, NO .bat, NO Python, NO wscript, NO reg.exe.
//
// Build:
//   Windows: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o RealSecCam-Observer-v2.4-Windows.exe .
//   macOS:   GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o RealSecCam-Observer-v2.4-macOS    .
//   Linux:   GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o RealSecCam-Observer-v2.4-Linux     .

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	Version              = "2.4.1"
	ReportURL            = "https://accelerated-sync-dev-flow.base44.app/functions/agentReport"
	ScanIntervalSec      = 30
	HeartbeatIntervalSec = 15
	PortScanTimeoutMs    = 800
	MaxConcurrentProbes  = 50
	WatchdogTimeoutSec   = 120
	MaxScanRetries       = 3
	DiagLogFile          = "observer-diag.json"
	PIDFile              = "observer.pid"
	KillPort             = 19876
)

var CameraPorts = []int{554, 8554, 8080, 8000, 80, 443, 37777, 34567, 9000}

var OUITable = map[string]string{
	"00:23:63": "Hikvision", "bc:ad:28": "Hikvision", "4c:bd:8f": "Hikvision",
	"8c:e7:48": "Hikvision", "a0:8c:f8": "Hikvision", "c0:56:e3": "Hikvision",
	"54:c4:15": "Hikvision", "b4:a3:82": "Hikvision", "44:19:b6": "Hikvision",
	"28:57:be": "Dahua", "3c:ef:8c": "Dahua", "e0:50:8b": "Dahua",
	"90:02:a9": "Dahua", "bc:32:b2": "Dahua", "a4:14:37": "Dahua",
	"c8:d5:fe": "Reolink", "ec:71:db": "Reolink", "d4:93:90": "Reolink",
	"e4:24:6c": "Reolink", "00:6a:e2": "Reolink", "dc:44:27": "Reolink",
	"b0:c5:ca": "Wyze", "2c:aa:8e": "Wyze", "4c:ed:fb": "Wyze", "d0:3f:27": "Wyze",
	"f4:f2:6d": "Amcrest", "e8:ad:a6": "Amcrest",
	"b4:e6:2d": "Axis", "00:0f:7c": "Axis", "ac:cc:8e": "Axis",
	"00:62:6e": "Foscam", "9c:8e:cd": "TP-Link Tapo",
	"1c:61:b4": "Arlo", "70:56:81": "Ring",
	"b0:be:76": "Eufy", "5c:aa:fd": "Eufy", "c0:49:ef": "Eufy",
	"ac:37:43": "Apple", "f8:ff:c2": "Apple", "a8:66:7f": "Apple",
	"6c:40:08": "Samsung", "94:35:0a": "Samsung", "f8:d0:ac": "Samsung",
	"8c:77:12": "Google", "48:d6:d5": "Google", "f4:f5:d8": "Google",
	"b8:27:eb": "Raspberry Pi", "dc:a6:32": "Raspberry Pi",
	"f0:9f:c2": "Ubiquiti", "b4:fb:e4": "Ubiquiti",
	"18:64:72": "TP-Link", "54:a7:03": "TP-Link",
}

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
	Type string             `json:"type"`
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

var (
	lastFound    atomic.Int64
	scanCount    atomic.Int64
	scannerAlive atomic.Int64
	diagMu       sync.Mutex
	diagLog      DiagnosticLog
	debugMode    bool
	onceMode     bool
	shutdownCh   = make(chan struct{})
	cachedSSID   string
	cachedIP     string
	cachedSubnet string
	cacheMu      sync.Once
)

func logf(format string, args ...interface{}) {
	fmt.Printf("["+time.Now().Format("15:04:05")+"] "+format+"\n", args...)
}

// hiddenCmd creates an exec.Cmd. On Windows, hiddenCmdWindows (observer_windows.go)
// sets CREATE_NO_WINDOW via SysProcAttr so no CMD flash occurs.
// On macOS/Linux no extra flags are needed.
func hiddenCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	hiddenCmdPlatform(cmd)
	return cmd
}

func initCache() {
	cacheMu.Do(func() {
		ifaces := getNetworkInterfacesRaw()
		if len(ifaces) > 0 {
			cachedIP = ifaces[0].IP
			cachedSubnet = ifaces[0].Subnet
		}
		cachedSSID = detectSSID()
		logf("Cache: ip=%s subnet=%s ssid=%s", cachedIP, cachedSubnet, cachedSSID)
	})
}

func getLocalIP() string     { return cachedIP }
func getLocalSubnet() string { return cachedSubnet }
func getSSID() string        { return cachedSSID }

func exeDir() string {
	p, err := os.Executable()
	if err != nil { return "." }
	return filepath.Dir(p)
}

func writePID() {
	os.WriteFile(filepath.Join(exeDir(), PIDFile), []byte(strconv.Itoa(os.Getpid())), 0644)
}

func removePID() { os.Remove(filepath.Join(exeDir(), PIDFile)) }

func startKillServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/shutdown", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{\"ok\":true,\"message\":\"Observer shutting down\"}") )
		go func() {
			time.Sleep(200 * time.Millisecond)
			close(shutdownCh)
		}()
	})
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		h, _ := os.Hostname()
		fmt.Fprintf(w, "{\"ok\":true,\"version\":\"%s\",\"host\":\"%s\",\"scans\":%d,\"devices\":%d}",
			Version, h, scanCount.Load(), lastFound.Load())
	})
	srv := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", KillPort), Handler: mux}
	go func() { srv.ListenAndServe() }()
	go func() {
		<-shutdownCh
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()
}

func detectSSID() string {
	switch runtime.GOOS {
	case "windows":
		out, err := hiddenCmd("netsh", "wlan", "show", "interfaces").Output()
		if err != nil { return "(wired)" }
		for _, line := range strings.Split(string(out), "\n") {
			t := strings.TrimSpace(line)
			if strings.HasPrefix(t, "SSID") && !strings.HasPrefix(t, "BSSID") {
				if parts := strings.SplitN(t, ":", 2); len(parts) == 2 {
					return strings.TrimSpace(parts[1])
				}
			}
		}
	case "darwin":
		out, err := hiddenCmd("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport", "-I").Output()
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
		out, err := hiddenCmd("iwgetid", "-r").Output()
		if err == nil {
			if s := strings.TrimSpace(string(out)); s != "" { return s }
		}
		out, _ = hiddenCmd("sh", "-c", "nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2").Output()
		if s := strings.TrimSpace(string(out)); s != "" { return s }
	}
	return "(wired)"
}

func getARPTable() map[string]string {
	m := map[string]string{}
	var out []byte
	var err error
	if runtime.GOOS == "windows" {
		out, err = hiddenCmd("arp", "-a").Output()
	} else {
		out, err = hiddenCmd("sh", "-c", "arp -n 2>/dev/null || arp -a 2>/dev/null").Output()
	}
	if err != nil { return m }
	for _, line := range strings.Split(string(out), "\n") {
		var ip, mac string
		for _, f := range strings.Fields(line) {
			if net.ParseIP(f) != nil && strings.Contains(f, ".") { ip = f }
			if (strings.Count(f, ":") == 5 || strings.Count(f, "-") == 5) && len(f) >= 17 {
				mac = strings.ToLower(strings.ReplaceAll(f, "-", ":"))
			}
		}
		if ip != "" && mac != "" && mac != "ff:ff:ff:ff:ff:ff" { m[ip] = mac }
	}
	return m
}

// showInstallNotification is implemented per-platform.
// Windows: native MessageBoxW via user32.dll (observer_windows.go).
// macOS/Linux: no-op (observer_unix.go).

func getNetworkInterfacesRaw() []NetworkInterface {
	result := []NetworkInterface{}
	ifaces, err := net.Interfaces()
	if err != nil { return result }
	skipPat := []string{"lo", "loopback", "virtual", "vmware", "vbox", "docker", "tunnel", "tap", "tun", "bluetooth"}
	for _, iface := range ifaces {
		name := strings.ToLower(iface.Name)
		skipped := false
		for _, p := range skipPat {
			if strings.Contains(name, p) { skipped = true; break }
		}
		if skipped || iface.Flags&net.FlagLoopback != 0 { continue }
		addrs, err := iface.Addrs()
		if err != nil { continue }
		for _, addr := range addrs {
			var ip net.IP
			var mask net.IPMask
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP; mask = v.Mask
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.To4() == nil { continue }
			if ip.To4()[0] == 169 && ip.To4()[1] == 254 { continue }
			subnet := ""
			if mask != nil {
				ones, _ := mask.Size()
				parts := strings.Split(ip.String(), ".")
				subnet = fmt.Sprintf("%s.%s.%s.0/%d", parts[0], parts[1], parts[2], ones)
			}
			result = append(result, NetworkInterface{Name: iface.Name, IP: ip.String(), MAC: iface.HardwareAddr.String(), Subnet: subnet})
		}
	}
	return result
}

func getNetworkInterfaces() []NetworkInterface { return getNetworkInterfacesRaw() }

func lookupOUI(mac string) string {
	if mac == "" { return "" }
	n := strings.ToLower(strings.ReplaceAll(mac, "-", ":"))
	if parts := strings.Split(n, ":"); len(parts) >= 3 {
		if brand, ok := OUITable[strings.Join(parts[:3], ":")]; ok { return brand }
	}
	return ""
}

func probePort(ip string, port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), time.Duration(PortScanTimeoutMs)*time.Millisecond)
	if err != nil { return false }
	conn.Close()
	return true
}

func probeDevice(ip string) *DiscoveredDevice {
	type res struct { port int; open bool }
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
		if r.open { open = append(open, r.port) }
	}
	if len(open) == 0 { return nil }
	return &DiscoveredDevice{IP: ip, Port: open[0], Ports: open}
}

func sweepSubnetBase(base string, arp map[string]string, ssid string) []DiscoveredDevice {
	ips := make([]string, 254)
	for i := range ips { ips[i] = fmt.Sprintf("%s.%d", base, i+1) }
	devices := []DiscoveredDevice{}
	for i := 0; i < len(ips); i += MaxConcurrentProbes {
		end := i + MaxConcurrentProbes
		if end > len(ips) { end = len(ips) }
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
			if r.d == nil { continue }
			mac := arp[r.d.IP]
			r.d.MAC = mac
			r.d.SSID = ssid
			r.d.Online = true
			r.d.Brand = lookupOUI(mac)
			devices = append(devices, *r.d)
		}
	}
	return devices
}

func sweepAllInterfaces() []DiscoveredDevice {
	ifaces := getNetworkInterfaces()
	if len(ifaces) == 0 { return nil }
	arp := getARPTable()
	ssid := getSSID()
	seen := map[string]bool{}
	all := []DiscoveredDevice{}
	for _, iface := range ifaces {
		parts := strings.Split(iface.IP, ".")
		if len(parts) < 3 { continue }
		base := strings.Join(parts[:3], ".")
		if seen[base] { continue }
		seen[base] = true
		logf("Sweeping %s.0/24 via %s", base, iface.Name)
		all = append(all, sweepSubnetBase(base, arp, ssid)...)
	}
	return all
}

func postJSON(payload interface{}) (string, error) {
	body, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("POST", ReportURL, bytes.NewReader(body))
	if err != nil { return "", err }
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil { return "", err }
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	buf.ReadFrom(resp.Body)
	return buf.String(), nil
}

func sendHeartbeat(camerasFound int) {
	h, _ := os.Hostname()
	_, err := postJSON(HeartbeatPayload{Type: "heartbeat", Data: HeartbeatData{
		Agent: "discovery", Host: h, SSID: getSSID(), LocalIP: getLocalIP(),
		LocalSubnet: getLocalSubnet(), CamerasFound: camerasFound, Version: Version, Status: "running",
	}})
	if err != nil { logf("[HB] error: %v", err) } else { logf("[HB] sent cameras=%d", camerasFound) }
	diagMu.Lock()
	diagLog.LastReport = fmt.Sprintf("heartbeat cameras=%d", camerasFound)
	diagMu.Unlock()
}

func sendDiscovery(devices []DiscoveredDevice) {
	if len(devices) == 0 { return }
	r, err := postJSON(DiscoveryPayload{Type: "discovery", Data: devices})
	if err != nil { logf("[Discovery] error: %v", err) } else { logf("[Discovery] reported %d devices resp=%s", len(devices), r) }
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
	os.WriteFile(filepath.Join(exeDir(), DiagLogFile), data, 0644)
}

// registerAutostart — pure Go on all platforms. NO reg.exe, NO PowerShell, NO scripts.
// Windows autostart (registry write via advapi32.dll) is in observer_windows.go.
func registerAutostart() {
	exePath, err := os.Executable()
	if err != nil { return }
	switch runtime.GOOS {
	case "windows":
		registerAutostartWindows(exePath)
	case "darwin":
		plistPath := filepath.Join(os.Getenv("HOME"), "Library", "LaunchAgents", "com.realseccam.observer.plist")
		if _, err := os.Stat(plistPath); err == nil { return }
		plistContent := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n  <key>Label</key><string>com.realseccam.observer</string>\n  <key>ProgramArguments</key><array><string>%s</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n</dict></plist>"
		plist := fmt.Sprintf(plistContent, exePath)
		os.MkdirAll(filepath.Dir(plistPath), 0755)
		if os.WriteFile(plistPath, []byte(plist), 0644) == nil {
			hiddenCmd("launchctl", "load", "-w", plistPath).Run()
		}
	default:
		dir := filepath.Join(os.Getenv("HOME"), ".config", "autostart")
		os.MkdirAll(dir, 0755)
		desktopPath := filepath.Join(dir, "realseccam-observer.desktop")
		if _, err := os.Stat(desktopPath); err == nil { return }
		content := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=RealSecCam Observer\nExec=%s\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n", exePath)
		os.WriteFile(desktopPath, []byte(content), 0644)
	}
}

func performScan() {
	logf("Scanning subnet=%s ssid=%s ip=%s", getLocalSubnet(), getSSID(), getLocalIP())
	var devices []DiscoveredDevice
	for attempt := 1; attempt <= MaxScanRetries; attempt++ {
		devices = sweepAllInterfaces()
		if len(devices) > 0 || attempt == MaxScanRetries { break }
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
		case <-shutdownCh:
			logf("Scanner stopping.")
			return
		}
	}
}

func runWatchdog() {
	scannerAlive.Store(time.Now().Unix())
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if time.Now().Unix()-scannerAlive.Load() > WatchdogTimeoutSec {
				logf("[Watchdog] Scanner hung — restarting")
				scannerAlive.Store(time.Now().Unix())
				go runScanner()
			}
		case <-shutdownCh:
			return
		}
	}
}

func main() {
	flag.BoolVar(&debugMode, "debug", false, "Enable verbose output")
	flag.BoolVar(&onceMode, "once", false, "Run a single scan then exit")
	flag.Parse()
	initCache()
	h, _ := os.Hostname()
	logf("RealSecCam Observer v%s  host=%s  ip=%s  ssid=%s", Version, h, getLocalIP(), getSSID())
	writePID()
	defer removePID()
	registerAutostart()
	startKillServer()
	showInstallNotification()
	if onceMode { performScan(); return }
	go runScanner()
	go runWatchdog()
	<-shutdownCh
	logf("Observer shutting down.")
}