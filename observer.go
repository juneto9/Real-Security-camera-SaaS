// RealSecCam Observer v1.4
// Zero-touch discovery agent.
// - System tray icon: always running, survives window close.
// - Auto-registers itself to start on boot (Windows Registry / macOS LaunchAgent).
// - Double-click tray icon: toggle console log window.
// - Right-click tray: Show/Hide Logs | Restart Scanner | Quit.
// - Watchdog: silently restarts the scanner goroutine if it hangs.
// - Scans ALL non-loopback interfaces, not just the first one.
// - Retries failed scans up to 3 times before giving up.
// - Writes observer-diag.json next to the binary for troubleshooting.
//
// Build (GitHub Actions handles this automatically):
//   Windows: GOOS=windows GOARCH=amd64 go build -ldflags="-H windowsgui -s -w" -o RealSecCam-Observer-Windows.exe observer.go
//   macOS:   GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-macOS observer.go
//   Linux:   GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-Linux  observer.go

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	systray "github.com/getlantern/systray"
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
	"00:23:63": "Hikvision",    "bc:ad:28": "Hikvision",    "4c:bd:8f": "Hikvision",
	"8c:e7:48": "Hikvision",    "a0:8c:f8": "Hikvision",    "c0:56:e3": "Hikvision",
	"28:57:be": "Dahua",        "3c:ef:8c": "Dahua",         "e0:50:8b": "Dahua",
	"a4:14:37": "Dahua",        "c8:d5:fe": "Reolink",       "ec:71:db": "Reolink",
	"d4:93:90": "Reolink",      "e4:24:6c": "Reolink",       "b0:c5:ca": "Wyze",
	"f4:f2:6d": "Amcrest",      "00:62:6e": "Foscam",        "9c:8e:cd": "TP-Link Tapo",
	"1c:61:b4": "Arlo",         "70:56:81": "Ring",          "b4:e6:2d": "Axis",
	"b8:a4:4f": "Hanwha",       "b0:be:76": "Eufy",          "5c:aa:fd": "Eufy",
	"00:80:f0": "Panasonic",    "00:1b:c5": "Bosch",         "00:30:48": "Pelco",
	"d8:d7:75": "Uniview",      "e8:26:89": "Uniview",       "2c:63:45": "Tiandy",
	"00:e0:4c": "Generic",
}

// ─── Types ───────────────────────────────────────────────────────────────────

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
	Errors      []string           `json:"errors,omitempty"`
}

// ─── Globals ─────────────────────────────────────────────────────────────────

var (
	lastFound    atomic.Int64
	scanCount    atomic.Int64
	scannerAlive atomic.Int64 // updated by scanner, checked by watchdog
	diagMu       sync.Mutex
	diagLog      DiagnosticLog
	logLines     []string
	logMu        sync.Mutex
)

func logf(format string, args ...interface{}) {
	msg := fmt.Sprintf("["+time.Now().Format("15:04:05")+"] "+format, args...)
	fmt.Println(msg)
	logMu.Lock()
	logLines = append(logLines, msg)
	if len(logLines) > 500 {
		logLines = logLines[len(logLines)-500:]
	}
	logMu.Unlock()
}

// ─── Network helpers ─────────────────────────────────────────────────────────

func getNetworkInterfaces() []NetworkInterface {
	result := []NetworkInterface{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return result
	}
	skip := []string{"lo", "loopback", "virtual", "vmware", "vbox", "docker",
		"tunnel", "tap", "tun", "bluetooth", "isatap", "teredo", "pseudo"}
	for _, iface := range ifaces {
		name := strings.ToLower(iface.Name)
		skipped := false
		for _, p := range skip {
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
			// Skip link-local (169.254.x.x)
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
		out, err = exec.Command("sh", "-c", "nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2").Output()
		if err == nil {
			if s := strings.TrimSpace(string(out)); s != "" {
				return s
			}
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

// ─── Port scanning ───────────────────────────────────────────────────────────

func probePort(ip string, port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), time.Duration(PortScanTimeoutMs)*time.Millisecond)
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

// sweepSubnetBase sweeps one /24 subnet base (e.g. "192.168.1") and returns found devices.
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
		type batchResult struct{ d *DiscoveredDevice }
		batch := make([]batchResult, end-i)
		var wg sync.WaitGroup
		for j, ip := range ips[i:end] {
			wg.Add(1)
			go func(idx int, tip string) {
				defer wg.Done()
				batch[idx] = batchResult{probeDevice(tip)}
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

// sweepAllInterfaces scans ALL valid network interfaces (not just the first).
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
		logf("Sweeping subnet %s.0/24 via interface %s", base, iface.Name)
		devs := sweepSubnetBase(base, arp, ssid)
		all = append(all, devs...)
	}
	return all
}

// ─── Reporting ───────────────────────────────────────────────────────────────

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
	r, err := postJSON(HeartbeatPayload{Type: "heartbeat", Data: HeartbeatData{
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
		logf("[HB] network error: %v", err)
	} else {
		logf("[HB] sent cameras=%d resp=%s", camerasFound, r)
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
		logf("[Discovery] report error: %v", err)
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
	logPath := filepath.Join(filepath.Dir(exePath), DiagLogFile)
	os.WriteFile(logPath, data, 0644)
}

// ─── Auto-start ──────────────────────────────────────────────────────────────

func registerAutostart() {
	exePath, err := os.Executable()
	if err != nil {
		logf("[Autostart] cannot get exe path: %v", err)
		return
	}
	switch runtime.GOOS {
	case "windows":
		registerAutostartWindows(exePath)
	case "darwin":
		registerAutostartMacOS(exePath)
	default:
		registerAutostartLinux(exePath)
	}
}

func registerAutostartWindows(exePath string) {
	// Write to HKCU\Software\Microsoft\Windows\CurrentVersion\Run
	cmd := exec.Command("reg", "add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v", "RealSecCamObserver",
		"/t", "REG_SZ",
		"/d", exePath,
		"/f")
	if err := cmd.Run(); err != nil {
		logf("[Autostart] Windows registry error: %v", err)
	} else {
		logf("[Autostart] Registered in Windows startup registry")
	}
}

func registerAutostartMacOS(exePath string) {
	plistPath := filepath.Join(os.Getenv("HOME"), "Library", "LaunchAgents", "com.realseccam.observer.plist")
	if _, err := os.Stat(plistPath); err == nil {
		return // already registered
	}
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.realseccam.observer</string>
  <key>ProgramArguments</key>  <array><string>%s</string></array>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>/tmp/realseccam-observer.log</string>
  <key>StandardErrorPath</key> <string>/tmp/realseccam-observer.log</string>
</dict>
</plist>`, exePath)

	os.MkdirAll(filepath.Dir(plistPath), 0755)
	if err := os.WriteFile(plistPath, []byte(plist), 0644); err != nil {
		logf("[Autostart] macOS plist write error: %v", err)
		return
	}
	exec.Command("launchctl", "load", "-w", plistPath).Run()
	logf("[Autostart] Registered macOS LaunchAgent at %s", plistPath)
}

func registerAutostartLinux(exePath string) {
	// XDG autostart — works on most desktop Linux (GNOME, KDE, XFCE)
	dir := filepath.Join(os.Getenv("HOME"), ".config", "autostart")
	os.MkdirAll(dir, 0755)
	desktopPath := filepath.Join(dir, "realseccam-observer.desktop")
	if _, err := os.Stat(desktopPath); err == nil {
		return
	}
	content := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=RealSecCam Observer\nExec=%s\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n", exePath)
	if err := os.WriteFile(desktopPath, []byte(content), 0644); err != nil {
		logf("[Autostart] Linux autostart write error: %v", err)
	} else {
		logf("[Autostart] Registered Linux XDG autostart")
	}
}

// ─── Scanner goroutine ───────────────────────────────────────────────────────

func runScanner() {
	logf("Scanner started — sweep every %ds, heartbeat every %ds", ScanIntervalSec, HeartbeatIntervalSec)
	sendHeartbeat(0)

	// First scan immediately
	performScanWithRetry()

	scanTick := time.NewTicker(ScanIntervalSec * time.Second)
	hbTick := time.NewTicker(HeartbeatIntervalSec * time.Second)
	defer scanTick.Stop()
	defer hbTick.Stop()

	for {
		select {
		case <-scanTick.C:
			performScanWithRetry()
		case <-hbTick.C:
			sendHeartbeat(int(lastFound.Load()))
		}
	}
}

func performScanWithRetry() {
	ssid := getSSID()
	ip := getLocalIP()
	subnet := getLocalSubnet()
	logf("Scanning all interfaces  subnet=%s  ssid=%s  ip=%s", subnet, ssid, ip)

	var devices []DiscoveredDevice
	var err error
	for attempt := 1; attempt <= MaxScanRetries; attempt++ {
		devices = sweepAllInterfaces()
		if devices != nil || attempt == MaxScanRetries {
			err = nil
			break
		}
		logf("Scan attempt %d failed, retrying in 5s...", attempt)
		time.Sleep(5 * time.Second)
	}

	if err != nil {
		logf("Scan failed after %d attempts", MaxScanRetries)
		diagMu.Lock()
		diagLog.Errors = append(diagLog.Errors, fmt.Sprintf("%s scan-failed", time.Now().Format(time.RFC3339)))
		diagMu.Unlock()
		return
	}

	count := int64(len(devices))
	logf("Found %d devices on network", count)
	lastFound.Store(count)
	scanCount.Add(1)
	writeDiag(devices)
	sendDiscovery(devices)
	sendHeartbeat(int(count))
	scannerAlive.Store(time.Now().Unix())
}

// ─── Watchdog goroutine ──────────────────────────────────────────────────────
// If the scanner stops updating scannerAlive for WatchdogTimeoutSec,
// the watchdog restarts it. The user never sees this — it is fully silent.

func runWatchdog(restartScanner func()) {
	scannerAlive.Store(time.Now().Unix())
	for range time.NewTicker(30 * time.Second).C {
		last := scannerAlive.Load()
		if time.Now().Unix()-last > WatchdogTimeoutSec {
			logf("[Watchdog] Scanner appears hung — restarting...")
			go restartScanner()
			scannerAlive.Store(time.Now().Unix())
		}
	}
}

// ─── Tray icon ───────────────────────────────────────────────────────────────

func onReady() {
	systray.SetTitle("RealSecCam Observer")
	systray.SetTooltip("Observing and reporting")

	// Icon bytes — embedded 16x16 PNG
	// For the GitHub build we embed the real icon via go:embed.
	// Fallback: a minimal 1x1 blue PNG so it compiles without the asset.
	setTrayIcon()

	mShow := systray.AddMenuItem("Show Logs", "Open log window")
	systray.AddSeparator()
	mRestart := systray.AddMenuItem("Restart Scanner", "Force an immediate scan cycle")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Quit Observer", "Stop the Observer entirely")

	go func() {
		for {
			select {
			case <-mShow.ClickedCh:
				showLogWindow()
			case <-mRestart.ClickedCh:
				logf("[Tray] Manual restart requested")
				go performScanWithRetry()
			case <-mQuit.ClickedCh:
				logf("[Tray] Quit requested")
				systray.Quit()
				os.Exit(0)
			}
		}
	}()
}

func onExit() {}

func showLogWindow() {
	logMu.Lock()
	lines := make([]string, len(logLines))
	copy(lines, logLines)
	logMu.Unlock()

	content := strings.Join(lines, "\n")
	h, _ := os.Hostname()
	title := fmt.Sprintf("RealSecCam Observer v%s — %s", Version, h)

	switch runtime.GOOS {
	case "windows":
		// Write to temp file and open with notepad
		tmp := filepath.Join(os.TempDir(), "observer-log.txt")
		os.WriteFile(tmp, []byte(content), 0644)
		exec.Command("cmd", "/c", "start", title, "notepad", tmp).Start()
	case "darwin":
		tmp := filepath.Join(os.TempDir(), "observer-log.txt")
		os.WriteFile(tmp, []byte(content), 0644)
		exec.Command("open", "-a", "Console", tmp).Start()
	default:
		tmp := filepath.Join(os.TempDir(), "observer-log.txt")
		os.WriteFile(tmp, []byte(content), 0644)
		// Try common terminal emulators
		for _, term := range []string{"xterm", "gnome-terminal", "konsole", "xfce4-terminal"} {
			if exec.Command("which", term).Run() == nil {
				exec.Command(term, "-e", "tail -f "+tmp).Start()
				break
			}
		}
	}
}

// setTrayIcon sets a minimal embedded tray icon.
// The GitHub Actions build step will replace this with the real observer PNG.
func setTrayIcon() {
	// Minimal 1x1 blue PNG (placeholder — CI injects real icon)
	iconBytes := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x91, 0x68,
		0x36, 0x00, 0x00, 0x00, 0x24, 0x49, 0x44, 0x41,
		0x54, 0x78, 0x9c, 0x62, 0x3c, 0x70, 0x80, 0x81,
		0x81, 0x81, 0x81, 0x81, 0x91, 0x91, 0x91, 0x91,
		0x01, 0x08, 0x31, 0x00, 0x00, 0x0c, 0x0c, 0x02,
		0x00, 0x01, 0x95, 0x00, 0x01, 0x4e, 0x7d, 0x5e,
		0xcc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
		0x44, 0xae, 0x42, 0x60, 0x82,
	}
	systray.SetIcon(iconBytes)
}

// ─── Main ────────────────────────────────────────────────────────────────────

func main() {
	h, _ := os.Hostname()
	logf("RealSecCam Observer v%s  host=%s  ip=%s  ssid=%s", Version, h, getLocalIP(), getSSID())
	logf("Reporting to: %s", ReportURL)

	// Register autostart silently on first run
	registerAutostart()

	// Start the scanner + watchdog in background goroutines
	go runScanner()
	go runWatchdog(func() { go runScanner() })

	// Hand control to the system tray (blocks until Quit is selected)
	// Closing the window sends to tray; only Quit menu item exits the process.
	systray.Run(onReady, onExit)
}
