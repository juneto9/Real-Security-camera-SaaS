// ObserverStreamer v1.2.4
// Single binary: LAN discovery + webcam streaming via FFmpeg → MediaMTX.
// Pure Go stdlib. No CGO. No external Go deps.
// Windows: installs to C:\Program Files\RealSecCam\ObserverStreamer\
// macOS:   installs to /Applications/RealSecCam/
// Linux:   installs to /opt/realseccam/
//
// Build:
//   Windows: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o ObserverStreamer1.2.4.exe .
//   macOS:   GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ObserverStreamer1.2.4-macOS .
//   Linux:   GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ObserverStreamer1.2.4-Linux .

package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
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
	Version              = "1.2.4"
	ReportURL            = "https://accelerated-sync-dev-flow.base44.app/functions/agentReport"
	RelayHost            = "137.184.65.114"
	RelayRTSPPort        = 8554
	ScanIntervalSec      = 30
	HeartbeatIntervalSec = 15
	StreamHeartbeatSec   = 20
	PortScanTimeoutMs    = 800
	MaxConcurrentProbes  = 50
	WatchdogTimeoutSec   = 120
	MaxScanRetries       = 3
	DiagLogFile          = "observer-diag.json"
	PIDFile              = "observer.pid"
	KillPort             = 19876
	// FFmpeg auto-download (Windows only)
	FFmpegURL  = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
	FFmpegZip  = "ffmpeg.zip"
	FFmpegExe  = "ffmpeg.exe"
)

var AllPorts = []int{554, 8554, 8080, 8000, 80, 443, 37777, 34567, 9000, 4747, 7070, 1935, 5000, 8081}

// OUITable — lean "top 50" for instant recognition inside the binary.
// Unknown MACs are resolved in the cloud by agentReport's background live-lookup.
var OUITable = map[string]string{
	// ── Security cameras ──
	"00:23:63": "Hikvision", "4c:bd:8f": "Hikvision", "54:c4:15": "Hikvision",
	"94:e1:ac": "Hikvision", "bc:ad:28": "Hikvision",
	"08:ed:ed": "Dahua",     "14:a7:8b": "Dahua",     "3c:ef:8c": "Dahua",
	"4c:11:bf": "Dahua",     "bc:32:5f": "Dahua",
	"00:40:8c": "Axis",      "ac:cc:8e": "Axis",
	"c8:d5:fe": "Reolink",   "ec:71:db": "Reolink",   "dc:44:27": "Reolink",
	"b0:c5:ca": "Wyze",      "2c:aa:8e": "Wyze",      "d0:3f:27": "Wyze",
	"b0:be:76": "Eufy",      "5c:aa:fd": "Eufy",      "c0:49:ef": "Eufy",
	"70:56:81": "Ring",      "fc:a6:67": "Ring",      "b0:09:da": "Ring",
	"1c:61:b4": "Arlo",      "6c:e8:c6": "Arlo",
	"f4:f2:6d": "Amcrest",   "9c:8e:cd": "TP-Link Tapo",
	"00:09:18": "Hanwha",    "e4:30:22": "Hanwha",
	"00:03:c5": "Mobotix",   "00:02:d1": "Vivotek",   "c8:93:46": "SkyBell",
	// ── Apple (iPhones, iPads, MacBooks — primary Observer platform) ──
	"9c:f4:8d": "Apple", "ac:bc:32": "Apple", "bc:f1:71": "Apple",
	"68:5b:35": "Apple", "f8:4d:89": "Apple", "d0:81:7a": "Apple",
	"80:e6:50": "Apple", "a8:51:5b": "Apple", "00:f7:6f": "Apple",
	"f0:99:bf": "Apple", "70:ec:e4": "Apple", "cc:44:63": "Apple",
	"00:88:65": "Apple", "a8:66:7f": "Apple", "78:4f:43": "Apple",
	"a4:83:e7": "Apple", "00:17:f2": "Apple", "28:cf:da": "Apple",
	"88:1f:a1": "Apple", "b8:09:8a": "Apple", "dc:2b:2a": "Apple",
	// ── Samsung Galaxy phones & tablets ──
	"8c:f5:a3": "Samsung", "a4:23:05": "Samsung", "c0:bd:d1": "Samsung",
	"78:59:5e": "Samsung", "b4:3a:28": "Samsung", "6c:40:08": "Samsung",
	"94:35:0a": "Samsung",  "f8:d0:ac": "Samsung",
	// ── Google Pixel ──
	"3c:28:6d": "Google", "54:60:09": "Google", "8c:77:12": "Google", "f4:f5:d8": "Google",
	// ── Amazon Fire / Echo ──
	"f0:27:2d": "Amazon", "74:c2:46": "Amazon", "44:65:0d": "Amazon", "68:37:e9": "Amazon",
	// ── Common laptops ──
	"5c:fb:3a": "HP", "b4:b6:86": "HP",
	"00:23:ae": "Lenovo", "8c:8d:28": "Lenovo",
	"18:66:da": "Dell",   "b8:ca:3a": "Dell",
	"b8:27:eb": "Raspberry Pi", "dc:a6:32": "Raspberry Pi",
}

type NetworkInterface struct {
	Name   string `json:"name"`
	IP     string `json:"ip"`
	MAC    string `json:"mac"`
	Subnet string `json:"subnet"`
}

type DiscoveredDevice struct {
	IP         string `json:"ip"`
	MAC        string `json:"mac"`
	Port       int    `json:"port"`
	Ports      []int  `json:"ports"`
	Brand      string `json:"brand"`
	Hostname   string `json:"hostname"`
	SSID       string `json:"ssid"`
	Online     bool   `json:"online"`
	DeviceType string `json:"device_type"`
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

type StreamUpdatePayload struct {
	Type string           `json:"type"`
	Data StreamUpdateData `json:"data"`
}

type StreamUpdateData struct {
	IP         string `json:"ip"`
	MAC        string `json:"mac"`
	HlsURL     string `json:"hls_url"`
	RelayHost  string `json:"relay_host"`
	DeviceName string `json:"device_name"`
}

type ErrorReportPayload struct {
	Type string          `json:"type"`
	Data ErrorReportData `json:"data"`
}

type ErrorReportData struct {
	Host    string `json:"host"`
	Version string `json:"version"`
	Error   string `json:"error"`
	Stage   string `json:"stage"`
}

func reportError(stage, errMsg string) {
	h, _ := os.Hostname()
	postJSON(ErrorReportPayload{Type: "error_report", Data: ErrorReportData{
		Host: h, Version: Version, Error: errMsg, Stage: stage,
	}})
	logf("[ERROR] stage=%s err=%s", stage, errMsg)
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
	cacheMu      sync.RWMutex
	ffmpegPath   string
	ffmpegMu     sync.Mutex
)

// logFile is the rolling log written to disk (no console in -H windowsgui builds).
var (
	logFileMu sync.Mutex
	logFileHandle *os.File
)

func initLogFile() {
	f, err := os.OpenFile(filepath.Join(exeDir(), "observer.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err == nil { logFileHandle = f }
}

func logf(format string, args ...interface{}) {
	line := fmt.Sprintf("["+time.Now().Format("15:04:05")+"] "+format+"\n", args...)
	logFileMu.Lock()
	if logFileHandle != nil { logFileHandle.WriteString(line) }
	logFileMu.Unlock()
}

func hiddenCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	hiddenCmdPlatform(cmd)
	return cmd
}

func exeDir() string {
	p, err := os.Executable()
	if err != nil { return "." }
	return filepath.Dir(p)
}

// installDir returns the canonical install location for the current OS.
// Windows: C:\Program Files\RealSecCam\ObserverStreamer
// macOS:   /Applications/RealSecCam
// Linux:   /opt/realseccam
func installDir() string {
	switch runtime.GOOS {
	case "windows":
		pf := os.Getenv("ProgramFiles")
		if pf == "" { pf = "C:\\Program Files" }
		return filepath.Join(pf, "RealSecCam", "ObserverStreamer")
	case "darwin":
		return "/Applications/RealSecCam"
	default:
		return "/opt/realseccam"
	}
}

// ensureInstalled copies the running binary into the canonical install directory
// if it is not already running from there. It then re-launches from the install
// path and exits the current process, so all subsequent work happens from the
// proper location. Returns true if a re-launch was triggered (caller should exit).
func ensureInstalled() bool {
	targetDir := installDir()
	// Determine the installed binary name (always versioned so old copies stay alongside)
	myExe, err := os.Executable()
	if err != nil { return false }
	myExeAbs, err := filepath.Abs(myExe)
	if err != nil { return false }
	targetExe := filepath.Join(targetDir, filepath.Base(myExeAbs))

	// Already running from install dir — nothing to do
	if strings.EqualFold(filepath.Dir(myExeAbs), targetDir) { return false }

	// Create install dir
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		logf("[Install] Cannot create install dir %s: %v — running from current location", targetDir, err)
		return false
	}

	// Copy binary to install dir
	src, err := os.Open(myExeAbs)
	if err != nil { logf("[Install] Cannot open self: %v", err); return false }
	defer src.Close()
	dst, err := os.OpenFile(targetExe, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil { logf("[Install] Cannot write to install dir: %v — running from current location", err); return false }
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(targetExe)
		logf("[Install] Copy failed: %v", err)
		return false
	}
	dst.Close()
	logf("[Install] Installed to %s", targetExe)

	// Re-launch from install dir
	cmd := exec.Command(targetExe, os.Args[1:]...)
	hiddenCmdPlatform(cmd)
	if err := cmd.Start(); err != nil {
		logf("[Install] Re-launch failed: %v — continuing from current location", err)
		return false
	}
	logf("[Install] Re-launched PID=%d from %s — exiting launcher", cmd.Process.Pid, targetExe)
	return true // caller should os.Exit(0)
}

func initCache() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	ifaces := getNetworkInterfacesRaw()
	if len(ifaces) > 0 {
		cachedIP = ifaces[0].IP
		cachedSubnet = ifaces[0].Subnet
	}
	cachedSSID = detectSSID()
	logf("Cache: ip=%s subnet=%s ssid=%s", cachedIP, cachedSubnet, cachedSSID)
}

func getLocalIP() string     { cacheMu.RLock(); defer cacheMu.RUnlock(); return cachedIP }
func getLocalSubnet() string { cacheMu.RLock(); defer cacheMu.RUnlock(); return cachedSubnet }
func getSSID() string        { cacheMu.RLock(); defer cacheMu.RUnlock(); return cachedSSID }

func getLocalMAC() string {
	ifaces := getNetworkInterfacesRaw()
	if len(ifaces) > 0 { return ifaces[0].MAC }
	return ""
}

func writePID() {
	os.WriteFile(filepath.Join(exeDir(), PIDFile), []byte(strconv.Itoa(os.Getpid())), 0644)
}
func removePID() { os.Remove(filepath.Join(exeDir(), PIDFile)) }

func startKillServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/shutdown", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{\"ok\":true,\"message\":\"ObserverStreamer shutting down\"}"))
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
		// Try WiFi first
		out, err := hiddenCmd("netsh", "wlan", "show", "interfaces").Output()
		if err == nil {
			var ifaceName, ssid string
			for _, line := range strings.Split(string(out), "\n") {
				t := strings.TrimSpace(line)
				if strings.HasPrefix(t, "Name") {
					if parts := strings.SplitN(t, ":", 2); len(parts) == 2 {
						ifaceName = strings.TrimSpace(parts[1])
					}
				}
				if strings.HasPrefix(t, "SSID") && !strings.HasPrefix(t, "BSSID") {
					if parts := strings.SplitN(t, ":", 2); len(parts) == 2 {
						ssid = strings.TrimSpace(parts[1])
					}
				}
				_ = ifaceName
			}
			if ssid != "" { return ssid }
		}
		// Wired: find active Ethernet adapter name
		out2, err2 := hiddenCmd("netsh", "interface", "show", "interface").Output()
		if err2 == nil {
			for _, line := range strings.Split(string(out2), "\n") {
				fields := strings.Fields(line)
				// Format: AdminState  State  Type  Interface Name
				if len(fields) >= 4 && strings.EqualFold(fields[0], "Enabled") && strings.EqualFold(fields[1], "Connected") {
					ifName := strings.Join(fields[3:], " ")
					ifLower := strings.ToLower(ifName)
					if strings.Contains(ifLower, "ethernet") || strings.Contains(ifLower, "local area") || strings.Contains(ifLower, "lan") {
						return "Ethernet (" + ifName + ")"
					}
				}
			}
		}
		return "(wired)"
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
		return "(wired)"
	default:
		out, err := hiddenCmd("iwgetid", "-r").Output()
		if err == nil {
			if s := strings.TrimSpace(string(out)); s != "" { return s }
		}
		out, _ = hiddenCmd("sh", "-c", "nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2").Output()
		if s := strings.TrimSpace(string(out)); s != "" { return s }
		return "(wired)"
	}
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

func min(a, b int) int { if a < b { return a }; return b }

func lookupOUI(mac string) string {
	if mac == "" { return "" }
	n := strings.ToLower(strings.ReplaceAll(mac, "-", ":"))
	if parts := strings.Split(n, ":"); len(parts) >= 3 {
		if brand, ok := OUITable[strings.Join(parts[:3], ":")]; ok { return brand }
	}
	return ""
}

func resolveHostname(ip string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	names, err := net.DefaultResolver.LookupAddr(ctx, ip)
	if err == nil && len(names) > 0 {
		h := strings.TrimSuffix(strings.TrimSuffix(names[0], "."), ".local")
		if h != "" && h != ip { return h }
	}
	return ""
}

func probePort(ip string, port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), time.Duration(PortScanTimeoutMs)*time.Millisecond)
	if err != nil { return false }
	conn.Close()
	return true
}

func probeDevicePorts(ip string) []int {
	type res struct { port int; open bool }
	results := make([]res, len(AllPorts))
	var wg sync.WaitGroup
	for i, p := range AllPorts {
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
	return open
}

func inferDeviceType(brand string, ports []int) string {
	b := strings.ToLower(brand)
	camBrands := []string{"hikvision","dahua","reolink","wyze","amcrest","foscam","eufy","arlo","ring","axis","hanwha","tapo","uniview","bosch","pelco","mobotix","vivotek","avigilon"}
	for _, cb := range camBrands {
		if strings.Contains(b, cb) { return "ip_camera" }
	}
	camPorts := map[int]bool{554: true, 8554: true, 34567: true, 37777: true, 9000: true}
	for _, p := range ports {
		if camPorts[p] { return "ip_camera" }
	}
	phonePorts := map[int]bool{4747: true, 7070: true}
	for _, p := range ports {
		if phonePorts[p] { return "phone" }
	}
	phoneBrands := []string{"samsung","apple","oneplus","xiaomi","huawei","oppo","motorola","lg electronics","sony mobile","google","amazon"}
	for _, pb := range phoneBrands {
		if strings.Contains(b, pb) { return "phone" }
	}
	pcBrands := []string{"intel","realtek","broadcom","lenovo","dell","hewlett","hp inc","hp","asus","acer","msi","toshiba","ralink","qualcomm","chongqing fugui"}
	for _, pb := range pcBrands {
		if strings.Contains(b, pb) { return "laptop" }
	}
	if brand == "" { return "unknown" }
	return "unknown"
}

func sweepSubnetBase(base string, arp map[string]string, ssid string) []DiscoveredDevice {
	ips := make([]string, 254)
	for i := range ips { ips[i] = fmt.Sprintf("%s.%d", base, i+1) }
	devices := []DiscoveredDevice{}
	arpReported := map[string]bool{}
	type arpJob struct{ ip, mac string }
	arpJobs := []arpJob{}
	for ip, mac := range arp {
		if strings.HasPrefix(ip, base+".") { arpJobs = append(arpJobs, arpJob{ip, mac}) }
	}
	type arpRes struct {
		ip, mac, brand, hostname string
		ports []int
		dt    string
	}
	arpResults := make([]arpRes, len(arpJobs))
	var wg0 sync.WaitGroup
	for i, job := range arpJobs {
		wg0.Add(1)
		go func(idx int, j arpJob) {
			defer wg0.Done()
			brand := lookupOUI(j.mac)
			ports := probeDevicePorts(j.ip)
			dt := inferDeviceType(brand, ports)
			hn := resolveHostname(j.ip)
			arpResults[idx] = arpRes{j.ip, j.mac, brand, hn, ports, dt}
		}(i, job)
	}
	wg0.Wait()
	for _, r := range arpResults {
		p := 0
		if len(r.ports) > 0 { p = r.ports[0] }
		devices = append(devices, DiscoveredDevice{
			IP: r.ip, MAC: r.mac, Port: p, Ports: r.ports,
			Brand: r.brand, Hostname: r.hostname, SSID: ssid, Online: true, DeviceType: r.dt,
		})
		arpReported[r.ip] = true
		logf("ARP: %s mac=%s brand=%s type=%s", r.ip, r.mac, r.brand, r.dt)
	}
	for i := 0; i < len(ips); i += MaxConcurrentProbes {
		end := i + MaxConcurrentProbes
		if end > len(ips) { end = len(ips) }
		type br struct{ ip string; ports []int }
		batch := make([]br, end-i)
		var wg sync.WaitGroup
		for j, ip := range ips[i:end] {
			if arpReported[ip] { batch[j] = br{ip: ""}; continue }
			wg.Add(1)
			go func(idx int, tip string) {
				defer wg.Done()
				batch[idx] = br{ip: tip, ports: probeDevicePorts(tip)}
			}(j, ip)
		}
		wg.Wait()
		for _, r := range batch {
			if r.ip == "" || len(r.ports) == 0 { continue }
			mac := arp[r.ip]
			brand := lookupOUI(mac)
			dt := inferDeviceType(brand, r.ports)
			hn := resolveHostname(r.ip)
			devices = append(devices, DiscoveredDevice{
				IP: r.ip, MAC: mac, Port: r.ports[0], Ports: r.ports,
				Brand: brand, Hostname: hn, SSID: ssid, Online: true, DeviceType: dt,
			})
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

	// Collect our own IPs so we can include ourselves in the report
	ownIPs := map[string]bool{}
	for _, iface := range ifaces { ownIPs[iface.IP] = true }

	for _, iface := range ifaces {
		parts := strings.Split(iface.IP, ".")
		if len(parts) < 3 { continue }
		base := strings.Join(parts[:3], ".")
		if seen[base] { continue }
		seen[base] = true
		logf("Sweeping %s.0/24 via %s", base, iface.Name)
		all = append(all, sweepSubnetBase(base, arp, ssid)...)
	}

	// Add self — the machine running the observer is always "on the network"
	// It won't appear in ARP (you can't ARP yourself) so we inject it manually.
	h, _ := os.Hostname()
	for _, iface := range ifaces {
		if iface.IP == "" || iface.MAC == "" { continue }
		// Skip if already discovered via port scan (unlikely but possible)
		alreadyFound := false
		for _, d := range all {
			if d.IP == iface.IP { alreadyFound = true; break }
		}
		if alreadyFound { continue }
		dt := inferDeviceType(lookupOUI(iface.MAC), []int{})
		if dt == "unknown" { dt = "laptop" }
		all = append(all, DiscoveredDevice{
			IP: iface.IP, MAC: iface.MAC, Port: 0, Ports: []int{},
			Brand: lookupOUI(iface.MAC), Hostname: h,
			SSID: ssid, Online: true, DeviceType: dt,
		})
		logf("Self: %s mac=%s hostname=%s", iface.IP, iface.MAC, h)
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

func sendHeartbeat(agent string, camerasFound int) {
	h, _ := os.Hostname()
	_, err := postJSON(HeartbeatPayload{Type: "heartbeat", Data: HeartbeatData{
		Agent: agent, Host: h, SSID: getSSID(), LocalIP: getLocalIP(),
		LocalSubnet: getLocalSubnet(), CamerasFound: camerasFound, Version: Version, Status: "running",
	}})
	if err != nil { logf("[HB:%s] error: %v", agent, err) } else { logf("[HB:%s] sent cameras=%d", agent, camerasFound) }
}

func sendDiscovery(devices []DiscoveredDevice) {
	if len(devices) == 0 { return }
	r, err := postJSON(DiscoveryPayload{Type: "discovery", Data: devices})
	if err != nil { logf("[Discovery] error: %v", err) } else { logf("[Discovery] reported %d devices resp=%s", len(devices), r) }
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

func registerAutostart() {
	exePath, err := os.Executable()
	if err != nil { return }
	switch runtime.GOOS {
	case "windows":
		platformRegisterAutostart(exePath)
	case "darwin":
		plistPath := filepath.Join(os.Getenv("HOME"), "Library", "LaunchAgents", "com.realseccam.observerstreamer.plist")
		if _, err := os.Stat(plistPath); err == nil { return }
		plistContent := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n  <key>Label</key><string>com.realseccam.observerstreamer</string>\n  <key>ProgramArguments</key><array><string>%s</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n</dict></plist>"
		plist := fmt.Sprintf(plistContent, exePath)
		os.MkdirAll(filepath.Dir(plistPath), 0755)
		if os.WriteFile(plistPath, []byte(plist), 0644) == nil {
			hiddenCmd("launchctl", "load", "-w", plistPath).Run()
		}
	default:
		dir := filepath.Join(os.Getenv("HOME"), ".config", "autostart")
		os.MkdirAll(dir, 0755)
		desktopPath := filepath.Join(dir, "realseccam-observerstreamer.desktop")
		if _, err := os.Stat(desktopPath); err == nil { return }
		content := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=RealSecCam ObserverStreamer\nExec=%s\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n", exePath)
		os.WriteFile(desktopPath, []byte(content), 0644)
	}
}

func killStaleObservers() {
	myPID := os.Getpid()
	switch runtime.GOOS {
	case "windows":
		// Read all processes once via "tasklist /FO CSV /NH" and match in Go.
		out, err := hiddenCmd("tasklist", "/FO", "CSV", "/NH").Output()
		if err != nil { break }
		// Current binary name — NEVER kill ourselves
		myExe := strings.ToLower(filepath.Base(os.Args[0]))
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if line == "" { continue }
			fields := strings.Split(line, ",")
			if len(fields) < 2 { continue }
			exeName := strings.ToLower(strings.Trim(strings.TrimSpace(fields[0]), "\""))
			pidStr := strings.Trim(strings.TrimSpace(fields[1]), "\"")
			pid, err := strconv.Atoi(pidStr)
			if err != nil || pid == myPID || pid == 0 { continue }
			if exeName == myExe { continue } // never self-kill
			// Kill any ObserverStreamer*.exe that isn't us, plus all legacy names
			legacyPrefixes := []string{
				"observerstreamer",         // catches ObserverStreamer1.2.0.exe, 1.1.x, etc.
				"realseccam-observer",
				"realseccam-discovery-agent",
				"realseccam-agent",
				"realseccamagent",
				"discovery-agent",
			}
			matched := false
			for _, prefix := range legacyPrefixes {
				if strings.HasPrefix(exeName, prefix) { matched = true; break }
			}
			if matched {
				logf("[Cleanup] Killing stale PID=%d name=%s", pid, exeName)
				hiddenCmd("taskkill", "/F", "/PID", pidStr).Run()
			}
		}
	case "darwin", "linux":
		for _, pattern := range []string{"RealSecCam-Observer", "ObserverStreamer", "RealSecCam-Discovery", "realseccam-agent"} {
			out, err := exec.Command("pgrep", "-f", pattern).Output()
			if err != nil { continue }
			for _, pidStr := range strings.Fields(string(out)) {
				pid, err := strconv.Atoi(strings.TrimSpace(pidStr))
				if err != nil || pid == myPID { continue }
				logf("[Cleanup] Killing stale PID=%d", pid)
				exec.Command("kill", "-9", pidStr).Run()
			}
		}
	}
}

func performScan() {
	// Refresh network info on every scan — SSID can change (wifi roam, cable swap)
	initCache()
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
	sendHeartbeat("discovery", len(devices))
	scannerAlive.Store(time.Now().Unix())
}

func runScanner() {
	defer func() {
		if r := recover(); r != nil {
			logf("[Scanner] PANIC recovered: %v — restarting in 10s", r)
			reportError("scanner_panic", fmt.Sprintf("%v", r))
			time.Sleep(10 * time.Second)
			go runScanner()
		}
	}()
	logf("Scanner started (sweep every %ds)", ScanIntervalSec)
	sendHeartbeat("discovery", 0)
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
			sendHeartbeat("discovery", int(lastFound.Load()))
		case <-shutdownCh:
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

// ── Streaming (FFmpeg → RTSP → MediaMTX) ─────────────────────────────────────

// ensureFFmpeg returns the path to ffmpeg, downloading it on Windows if needed.
func ensureFFmpeg() (string, error) {
	ffmpegMu.Lock()
	defer ffmpegMu.Unlock()
	if ffmpegPath != "" { return ffmpegPath, nil }

	// Check system PATH first (works on macOS/Linux + Windows with ffmpeg installed)
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		ffmpegPath = p
		logf("[FFmpeg] Found on PATH: %s", p)
		return p, nil
	}

	if runtime.GOOS != "windows" {
		return "", fmt.Errorf("ffmpeg not found on PATH — install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)")
	}

	// Windows: check local cache first
	cachedExe := filepath.Join(exeDir(), FFmpegExe)
	if _, err := os.Stat(cachedExe); err == nil {
		ffmpegPath = cachedExe
		logf("[FFmpeg] Using cached: %s", cachedExe)
		return cachedExe, nil
	}

	// Download and extract
	logf("[FFmpeg] Not found — downloading from GitHub releases (~80 MB)...")
	zipPath := filepath.Join(exeDir(), FFmpegZip)
	resp, err := http.Get(FFmpegURL)
	if err != nil { return "", fmt.Errorf("ffmpeg download failed: %w", err) }
	defer resp.Body.Close()
	f, err := os.Create(zipPath)
	if err != nil { return "", err }
	io.Copy(f, resp.Body)
	f.Close()

	// Extract ffmpeg.exe from zip (it's in a bin/ subfolder)
	zr, err := zip.OpenReader(zipPath)
	if err != nil { return "", fmt.Errorf("zip open: %w", err) }
	defer zr.Close()
	for _, zf := range zr.File {
		if strings.HasSuffix(zf.Name, "/ffmpeg.exe") || zf.Name == "ffmpeg.exe" {
			rc, err := zf.Open()
			if err != nil { continue }
			out, err := os.Create(cachedExe)
			if err != nil { rc.Close(); continue }
			io.Copy(out, rc)
			out.Close()
			rc.Close()
			logf("[FFmpeg] Extracted to %s", cachedExe)
			break
		}
	}
	os.Remove(zipPath)

	if _, err := os.Stat(cachedExe); err != nil {
		return "", fmt.Errorf("ffmpeg extraction failed")
	}
	ffmpegPath = cachedExe
	return cachedExe, nil
}

// detectWebcamIndex returns the best available camera index (0-based).
// On Windows: tries name-based dshow listing first, then falls back to index probing.
// On macOS we use avfoundation device list.
// On Linux we check /dev/video* devices.
func detectWebcamIndex(ffmpeg string) (string, string, error) {
	switch runtime.GOOS {
	case "windows":
		// Strategy 1: Windows Media Foundation (mf) — works for NexiGo, Logitech, and most
		// modern USB cameras that register under Windows Camera Framework rather than DirectShow.
		for i := 0; i < 4; i++ {
			ctxMF, cancelMF := context.WithTimeout(context.Background(), 3*time.Second)
			probeMF := exec.CommandContext(ctxMF, ffmpeg,
				"-f", "lavfi", "-i", "nullsrc",
				"-f", "dshow", "-list_devices", "true", "-i", "dummy",
			)
			hiddenCmdPlatform(probeMF)
			cancelMF()
			// Also try mf directly
			ctxMF2, cancelMF2 := context.WithTimeout(context.Background(), 3*time.Second)
			probeMF2 := exec.CommandContext(ctxMF2, ffmpeg,
				"-f", "dshow", "-i", fmt.Sprintf("video=@device_idx_%d", i),
				"-t", "0.1", "-f", "null", "-",
			)
			hiddenCmdPlatform(probeMF2)
			out2, _ := probeMF2.CombinedOutput()
			cancelMF2()
			s2 := string(out2)
			if !strings.Contains(s2, "Could not find") && !strings.Contains(s2, "No such") && !strings.Contains(s2, "Immediate exit") {
				logf("[Streamer] Found dshow device at index %d", i)
				return "dshow", fmt.Sprintf("video=@device_idx_%d", i), nil
			}
			_ = probeMF
		}

		// Strategy 2: List dshow devices by name
		out, _ := hiddenCmd(ffmpeg, "-list_devices", "true", "-f", "dshow", "-i", "dummy").CombinedOutput()
		outStr := string(out)
		logf("[Streamer] dshow list: %s", outStr[:min(len(outStr), 800)])
		lines := strings.Split(outStr, "\n")
		inVideoSection := false
		for _, line := range lines {
			if strings.Contains(line, "DirectShow video devices") || strings.Contains(line, "video devices") {
				inVideoSection = true; continue
			}
			if strings.Contains(line, "DirectShow audio devices") || strings.Contains(line, "audio devices") { break }
			if !inVideoSection { continue }
			if idx := strings.Index(line, "\""); idx >= 0 {
				rest := line[idx+1:]
				if end := strings.Index(rest, "\""); end >= 0 {
					devName := rest[:end]
					if devName != "" && !strings.Contains(devName, "@device") {
						logf("[Streamer] Found dshow device by name: %s", devName)
						return "dshow", "video=" + devName, nil
					}
				}
			}
		}

		// Strategy 3: Windows Media Foundation — NexiGo and WCF cameras register here
		// Try mf input format (available in modern FFmpeg builds)
		for i := 0; i < 4; i++ {
			ctxMF3, cancelMF3 := context.WithTimeout(context.Background(), 3*time.Second)
			probeMF3 := exec.CommandContext(ctxMF3, ffmpeg,
				"-f", "dshow",
				"-video_size", "1280x720",
				"-framerate", "15",
				"-i", fmt.Sprintf("video=@device_idx_%d", i),
				"-t", "0.5", "-f", "null", "-",
			)
			hiddenCmdPlatform(probeMF3)
			out3, _ := probeMF3.CombinedOutput()
			cancelMF3()
			s3 := string(out3)
			if strings.Contains(s3, "frame=") || strings.Contains(s3, "fps=") || strings.Contains(s3, "kb/s") {
				logf("[Streamer] Strategy 3: dshow with size/fps succeeded at index %d", i)
				return "dshow", fmt.Sprintf("video=@device_idx_%d", i), nil
			}
		}

		// Strategy 4: vfwcap legacy fallback
		ctx4, cancel4 := context.WithTimeout(context.Background(), 2*time.Second)
		probeVfw := exec.CommandContext(ctx4, ffmpeg, "-f", "vfwcap", "-i", "0", "-t", "0.1", "-f", "null", "-")
		hiddenCmdPlatform(probeVfw)
		vfwOut, _ := probeVfw.CombinedOutput()
		cancel4()
		if !strings.Contains(string(vfwOut), "Could not find") && !strings.Contains(string(vfwOut), "No such") {
			logf("[Streamer] Found camera via vfwcap fallback")
			return "vfwcap", "0", nil
		}
		return "", "", fmt.Errorf("no webcam found via dshow/vfwcap — NexiGo detected in Device Manager but not in DirectShow. Run: ffmpeg -list_devices true -f dshow -i dummy and share output")

	case "darwin":
		out, _ := hiddenCmd(ffmpeg, "-f", "avfoundation", "-list_devices", "true", "-i", "").CombinedOutput()
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, "AVFoundation video device") { continue }
			// Lines like: "[AVFoundation indev @ ...] [0] FaceTime HD Camera"
			if strings.Contains(line, "[0]") || strings.Contains(line, "[1]") {
				if !strings.Contains(strings.ToLower(line), "screen") {
					return "avfoundation", "0", nil
				}
			}
		}
		return "avfoundation", "0", nil // best guess

	default: // Linux
		for i := 0; i < 4; i++ {
			dev := fmt.Sprintf("/dev/video%d", i)
			if _, err := os.Stat(dev); err == nil {
				return "v4l2", dev, nil
			}
		}
		return "", "", fmt.Errorf("no /dev/video* device found")
	}
}

// streamWebcam captures the local webcam and pushes to MediaMTX via RTSP.
// Restarts FFmpeg automatically on crash. Reports HLS URL to dashboard.
func runStreamer() {
	defer func() {
		if r := recover(); r != nil {
			logf("[Streamer] PANIC recovered: %v — streamer disabled, discovery continues", r)
			reportError("streamer_panic", fmt.Sprintf("%v", r))
		}
	}()
	ffmpeg, err := ensureFFmpeg()
	if err != nil {
		logf("[Streamer] FFmpeg unavailable: %v — running in discovery-only mode", err)
		// Don't crash the process — discovery keeps running fine without webcam streaming
		return
	}

	h, _ := os.Hostname()
	// Use machine hostname as the RTSP path so each machine gets a unique stream
	rtspPath := strings.ToLower(strings.ReplaceAll(h, " ", "-"))
	rtspURL  := fmt.Sprintf("rtsp://%s:%d/%s", RelayHost, RelayRTSPPort, rtspPath)
	hlsURL   := fmt.Sprintf("http://%s:8888/%s/index.m3u8", RelayHost, rtspPath)

	logf("[Streamer] Will push to %s → HLS: %s", rtspURL, hlsURL)

	// Report HLS URL + webcam device name to dashboard so the camera record is named properly
	reportStream := func(deviceName string) {
		// Build a friendly display name from the actual webcam device name
		// e.g. "HP Wide Vision HD Camera" → used as the camera name in the dashboard
		_, err := postJSON(StreamUpdatePayload{
			Type: "stream_update",
			Data: StreamUpdateData{
				IP:         getLocalIP(),
				MAC:        getLocalMAC(),
				HlsURL:     hlsURL,
				RelayHost:  RelayHost,
				DeviceName: deviceName,
			},
		})
		if err != nil { logf("[Streamer] stream_update error: %v", err) }
	}

	for {
		select {
		case <-shutdownCh:
			return
		default:
		}

		inputFormat, inputDevice, err := detectWebcamIndex(ffmpeg)
		if err != nil {
			reportError("webcam_detect", err.Error())
			time.Sleep(30 * time.Second)
			continue
		}
		// Extract friendly name from "video=HP Wide Vision HD Camera" → "HP Wide Vision HD Camera"
		webcamDisplayName := inputDevice
		if strings.HasPrefix(inputDevice, "video=") {
			webcamDisplayName = strings.TrimPrefix(inputDevice, "video=")
		}
		logf("[Streamer] Capturing %s/%s → %s", inputFormat, inputDevice, rtspURL)

		// Build FFmpeg args per platform
		var args []string
		switch runtime.GOOS {
		case "windows":
			args = []string{
				"-f", inputFormat,
				"-video_size", "1280x720",
				"-framerate", "15",
				"-i", inputDevice,
				"-vcodec", "libx264",
				"-preset", "ultrafast",
				"-tune", "zerolatency",
				"-b:v", "800k",
				"-pix_fmt", "yuv420p",
				"-an",
				"-f", "rtsp",
				"-rtsp_transport", "tcp",
				rtspURL,
			}
		case "darwin":
			args = []string{
				"-f", inputFormat,
				"-framerate", "15",
				"-i", inputDevice + ":none",
				"-vcodec", "libx264",
				"-preset", "ultrafast",
				"-tune", "zerolatency",
				"-b:v", "800k",
				"-pix_fmt", "yuv420p",
				"-an",
				"-f", "rtsp",
				"-rtsp_transport", "tcp",
				rtspURL,
			}
		default:
			args = []string{
				"-f", inputFormat,
				"-i", inputDevice,
				"-vcodec", "libx264",
				"-preset", "ultrafast",
				"-tune", "zerolatency",
				"-b:v", "800k",
				"-pix_fmt", "yuv420p",
				"-an",
				"-f", "rtsp",
				"-rtsp_transport", "tcp",
				rtspURL,
			}
		}

		cmd := hiddenCmd(ffmpeg, args...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr

		if err := cmd.Start(); err != nil {
			logf("[Streamer] FFmpeg start error: %v — retry in 15s", err)
			time.Sleep(15 * time.Second)
			continue
		}

		// Report stream to dashboard once FFmpeg starts
		reportStream(webcamDisplayName)
		sendHeartbeat("streamer", 0)

		// Periodic heartbeat + stream re-report while FFmpeg runs
		ticker := time.NewTicker(StreamHeartbeatSec * time.Second)
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()

		outer:
			for {
				select {
				case err := <-done:
					ticker.Stop()
					logf("[Streamer] FFmpeg exited: %v — restarting in 5s", err)
					time.Sleep(5 * time.Second)
					break outer
				case <-ticker.C:
					reportStream(webcamDisplayName)
					sendHeartbeat("streamer", 0)
				case <-shutdownCh:
					ticker.Stop()
					cmd.Process.Kill()
					return
				}
			}
	}
}

func main() {
	flag.BoolVar(&debugMode, "debug", false, "Enable verbose output")
	flag.BoolVar(&onceMode, "once", false, "Run a single scan then exit")
	flag.Parse()

	// ── Step 1: Self-install — move to Program Files if not already there ──
	// initLogFile() is called first so we can log the install attempt.
	initLogFile()
	if ensureInstalled() {
		// Re-launched from install dir — this process is just the launcher, exit cleanly.
		os.Exit(0)
	}

	setConsoleTitle("RealSecCam ObserverStreamer v" + Version)
	cleanupOldAgentServices()
	killStaleObservers()
	time.Sleep(500 * time.Millisecond)
	initCache()
	h, _ := os.Hostname()
	logf("RealSecCam ObserverStreamer v%s  host=%s  ip=%s  ssid=%s", Version, h, getLocalIP(), getSSID())
	writePID()
	defer removePID()
	registerAutostart()
	startKillServer()
	showInstallNotification()
	if onceMode { performScan(); return }
	go runScanner()
	go runWatchdog()
	go runStreamer()
	<-shutdownCh
	logf("ObserverStreamer shutting down.")
}
