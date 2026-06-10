// RealSecCam Observer v1.9
// Zero-touch background discovery agent. Pure Go stdlib. No CGO. No external deps.
//
// v1.9 changes vs v1.8:
//   - Versioned output filenames: RealSecCam-Observer-v1.9-Windows.exe
//   - Child process hiding moved to observer_windows.go (build tag) — no more CMD flashes
//   - Notification via PowerShell MessageBox (comes to foreground reliably)
//   - ARP on Windows via pure Go net.Interfaces — no subprocess at all
//   - Version bump to 1.9.0
//
// Build:
//   Windows: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o RealSecCam-Observer-v1.9-Windows.exe .
//   macOS:   GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o RealSecCam-Observer-v1.9-macOS    .
//   Linux:   GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o RealSecCam-Observer-v1.9-Linux     .

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
	Version              = "1.9.0"
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
	// ── Hikvision ──
	"00:23:63": "Hikvision", "bc:ad:28": "Hikvision", "4c:bd:8f": "Hikvision",
	"8c:e7:48": "Hikvision", "a0:8c:f8": "Hikvision", "c0:56:e3": "Hikvision",
	"54:c4:15": "Hikvision", "b4:a3:82": "Hikvision", "44:19:b6": "Hikvision",
	"d0:27:88": "Hikvision", "78:a2:a0": "Hikvision", "30:8b:b2": "Hikvision",
	"c4:2f:90": "Hikvision", "e8:3a:12": "Hikvision",
	// ── Dahua ──
	"28:57:be": "Dahua", "3c:ef:8c": "Dahua", "e0:50:8b": "Dahua",
	"90:02:a9": "Dahua", "bc:32:b2": "Dahua", "a4:14:37": "Dahua",
	"4c:11:bf": "Dahua", "40:b0:76": "Dahua", "70:85:c4": "Dahua",
	"9c:8e:99": "Dahua",
	// ── Reolink ──
	"c8:d5:fe": "Reolink", "ec:71:db": "Reolink", "d4:93:90": "Reolink",
	"e4:24:6c": "Reolink", "00:6a:e2": "Reolink", "dc:44:27": "Reolink",
	"c4:1c:ff": "Reolink", "48:70:2c": "Reolink",
	// ── Wyze ──
	"b0:c5:ca": "Wyze", "2c:aa:8e": "Wyze", "4c:ed:fb": "Wyze", "d0:3f:27": "Wyze",
	"7c:78:b2": "Wyze",
	// ── Amcrest ──
	"f4:f2:6d": "Amcrest", "e8:ad:a6": "Amcrest", "b4:a2:eb": "Amcrest",
	"9c:8e:80": "Amcrest",
	// ── Axis ──
	"b4:e6:2d": "Axis", "00:0f:7c": "Axis", "ac:cc:8e": "Axis", "00:40:8c": "Axis",
	// ── Other IP Camera Brands ──
	"00:62:6e": "Foscam",     "9c:8e:cd": "TP-Link Tapo",
	"1c:61:b4": "Arlo",       "70:56:81": "Ring",
	"b8:a4:4f": "Hanwha",     "d4:6a:6a": "Hanwha",
	"b0:be:76": "Eufy",       "5c:aa:fd": "Eufy",       "c0:49:ef": "Eufy",
	"00:80:f0": "Panasonic",  "00:1b:c5": "Bosch",       "00:30:48": "Pelco",
	"d8:d7:75": "Uniview",    "e8:26:89": "Uniview",
	"2c:63:45": "Tiandy",
	"00:09:18": "Vivotek",    "00:1a:07": "Vivotek",
	"00:03:c5": "Mobotix",
	"00:1e:c0": "Avigilon",
	// ── Apple ──
	"ac:37:43": "Apple", "00:17:f2": "Apple", "f8:ff:c2": "Apple",
	"70:ef:00": "Apple", "a8:66:7f": "Apple", "78:fd:94": "Apple",
	"28:cf:e9": "Apple", "8c:85:90": "Apple", "dc:2b:61": "Apple",
	"f0:db:f8": "Apple", "3c:d0:f8": "Apple", "b8:e8:56": "Apple",
	"a4:c3:f0": "Apple", "d8:bb:c1": "Apple", "98:01:a7": "Apple",
	"60:f8:1d": "Apple", "04:4b:ed": "Apple", "58:40:4e": "Apple",
	"f4:d4:88": "Apple", "ac:de:48": "Apple", "00:cd:fe": "Apple",
	// ── Samsung ──
	"6c:40:08": "Samsung", "94:35:0a": "Samsung", "b4:3a:28": "Samsung",
	"f8:d0:ac": "Samsung", "78:f7:be": "Samsung", "8c:c8:cd": "Samsung",
	"50:01:bb": "Samsung", "24:4b:03": "Samsung", "cc:07:ab": "Samsung",
	"00:12:47": "Samsung",
	// ── Google / Android ──
	"8c:77:12": "Google", "48:d6:d5": "Google", "f4:f5:d8": "Google",
	"54:60:09": "Google", "3c:28:6d": "Google", "20:df:b9": "Google",
	// ── OnePlus / Xiaomi / Huawei / Oppo ──
	"d8:3a:dd": "OnePlus",  "8c:be:be": "OnePlus",
	"00:9e:c8": "Xiaomi",   "7c:49:eb": "Xiaomi",  "f8:a4:5f": "Xiaomi",
	"28:6c:07": "Xiaomi",   "64:09:80": "Xiaomi",  "ac:f7:f3": "Xiaomi",
	"04:f9:38": "Huawei",   "70:72:3c": "Huawei",  "34:6b:d3": "Huawei",
	"a4:99:47": "Huawei",   "28:31:52": "Huawei",  "2c:ab:00": "Huawei",
	"94:87:e0": "Oppo",
	// ── Routers ──
	"00:18:39": "Cisco",    "00:1e:f7": "Cisco",   "e8:b7:48": "Cisco",
	"18:64:72": "TP-Link",  "54:a7:03": "TP-Link", "30:de:4b": "TP-Link",
	"f0:9f:c2": "Ubiquiti", "b4:fb:e4": "Ubiquiti","78:8a:20": "Ubiquiti",
	"80:2a:a8": "Netgear",  "a0:40:a0": "Netgear", "c4:04:15": "Netgear",
	"20:e5:2a": "Belkin",   "94:10:3e": "Asus",    "50:46:5d": "Asus",
	"04:d4:c4": "Asus",     "b0:6e:bf": "Linksys",
	// ── Raspberry Pi ──
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

// ─── Globals ──────────────────────────────────────────────────────────────────

var (
	lastFound    atomic.Int64
	scanCount    atomic.Int64
	scannerAlive atomic.Int64
	diagMu       sync.Mutex
	diagLog      DiagnosticLog
	debugMode    bool
	onceMode     bool
	shutdownCh   = make(chan struct{})

	// Cached at startup
	cachedSSID   string
	cachedIP     string
	cachedSubnet string
	cacheMu      sync.Once
)

func logf(format string, args ...interface{}) {
	fmt.Printf("["+time.Now().Format("15:04:05")+"] "+format+"\n", args...)
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

// ─── PID file ─────────────────────────────────────────────────────────────────

func exeDir() string {
	p, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(p)
}

func writePID() {
	os.WriteFile(filepath.Join(exeDir(), PIDFile), []byte(strconv.Itoa(os.Getpid())), 0644)
}

func removePID() {
	os.Remove(filepath.Join(exeDir(), PIDFile))
}

// ─── Kill-switch server ───────────────────────────────────────────────────────

func startKillServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/shutdown", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true,"message":"Observer shutting down"}`))
		go func() {
			time.Sleep(200 * time.Millisecond)
			close(shutdownCh)
		}()
	})
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		h, _ := os.Hostname()
		fmt.Fprintf(w, `{"ok":true,"version":"%s","host":"%s","scans":%d,"devices":%d}`,
			Version, h, scanCount.Load(), lastFound.Load())
	})
	srv := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", KillPort), Handler: mux}
	go func() {
		srv.ListenAndServe()
	}()
	go func() {
		<-shutdownCh
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()
}

// ─── Network helpers ──────────────────────────────────────────────────────────

func getNetworkInterfacesRaw() []NetworkInterface {
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

func getNetworkInterfaces() []NetworkInterface {
	return getNetworkInterfacesRaw()
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
			r.d.Brand = lookupOUI(mac)
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
	os.WriteFile(filepath.Join(exeDir(), DiagLogFile), data, 0644)
}

// ─── Auto-start ───────────────────────────────────────────────────────────────

func registerAutostart() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	switch runtime.GOOS {
	case "windows":
		quotedPath := `"` + exePath + `"`
		runHidden("reg", "add",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			"/v", "RealSecCamObserver", "/t", "REG_SZ", "/d", quotedPath, "/f")
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
			cmd := exec.Command("launchctl", "load", "-w", plistPath)
			cmd.Run()
		}
	default:
		dir := filepath.Join(os.Getenv("HOME"), ".config", "autostart")
		os.MkdirAll(dir, 0755)
		desktopPath := filepath.Join(dir, "realseccam-observer.desktop")
		if _, err := os.Stat(desktopPath); err == nil {
			return
		}
		content := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=RealSecCam Observer\nExec=%s\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n", exePath)
		os.WriteFile(desktopPath, []byte(content), 0644)
	}
}

// ─── Scanner + Watchdog ───────────────────────────────────────────────────────

func performScan() {
	logf("Scanning subnet=%s ssid=%s ip=%s", getLocalSubnet(), getSSID(), getLocalIP())
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

// ─── Main ─────────────────────────────────────────────────────────────────────

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

	if onceMode {
		performScan()
		return
	}

	go runScanner()
	go runWatchdog()

	<-shutdownCh
	logf("Observer shutting down.")
}
