// RealSecCam Observer v1.3 - Native Discovery Agent
// Single self-contained binary. No dependencies.
//
// Build:
//   Windows: GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H=windowsgui" -o RealSecCam-Observer-Windows.exe observer.go
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
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	Version              = "1.3.0"
	ReportURL            = "https://accelerated-sync-dev-flow.base44.app/functions/agentReport"
	ScanIntervalSec      = 30
	HeartbeatIntervalSec = 15
	PortScanTimeoutMs    = 800
	MaxConcurrentProbes  = 40
)

// CameraPorts: common IP camera ports + mobile device ports
var CameraPorts = []int{554, 8554, 8080, 80, 8000, 8888, 62078, 5555}

// OUITable maps MAC OUI prefix -> brand name
var OUITable = map[string]string{
	// Hikvision
	"00:23:63": "Hikvision", "bc:ad:28": "Hikvision", "4c:bd:8f": "Hikvision",
	"8c:e7:48": "Hikvision", "a0:8c:f8": "Hikvision", "c0:56:e3": "Hikvision",
	"54:c4:15": "Hikvision", "b4:a3:82": "Hikvision",
	// Dahua
	"28:57:be": "Dahua", "3c:ef:8c": "Dahua", "e0:50:8b": "Dahua",
	"90:02:a9": "Dahua", "bc:32:b2": "Dahua",
	// Reolink
	"c8:d5:fe": "Reolink", "ec:71:db": "Reolink", "d4:93:90": "Reolink",
	"e4:24:6c": "Reolink", "00:6a:e2": "Reolink",
	// Wyze
	"b0:c5:ca": "Wyze", "2c:aa:8e": "Wyze", "4c:ed:fb": "Wyze",
	// Amcrest / Foscam / TP-Link
	"f4:f2:6d": "Amcrest", "00:62:6e": "Foscam", "9c:8e:cd": "TP-Link Tapo",
	// Arlo / Ring / Axis / Hanwha / Eufy
	"1c:61:b4": "Arlo", "70:56:81": "Ring", "b4:e6:2d": "Axis",
	"b8:a4:4f": "Hanwha", "b0:be:76": "Eufy", "5c:aa:fd": "Eufy",
	// Apple (iPhone/iPad/Mac)
	"00:03:93": "Apple", "00:0a:27": "Apple", "00:0a:95": "Apple",
	"00:11:24": "Apple", "00:16:cb": "Apple", "00:17:f2": "Apple",
	"00:1b:63": "Apple", "00:1c:b3": "Apple", "00:1d:4f": "Apple",
	"00:1e:52": "Apple", "00:1e:c2": "Apple", "00:1f:5b": "Apple",
	"00:1f:f3": "Apple", "00:21:e9": "Apple", "00:22:41": "Apple",
	"00:23:12": "Apple", "00:23:32": "Apple", "00:23:6c": "Apple",
	"00:24:36": "Apple", "00:25:00": "Apple", "00:25:4b": "Apple",
	"00:25:bc": "Apple", "00:26:08": "Apple", "00:26:4a": "Apple",
	"00:26:b0": "Apple", "00:26:bb": "Apple", "00:30:65": "Apple",
	"f0:db:f8": "Apple", "f0:d1:a9": "Apple", "f4:5c:89": "Apple",
	"f4:f1:5a": "Apple", "f8:27:93": "Apple", "f8:1e:df": "Apple",
	"a8:bb:cf": "Apple", "ac:de:48": "Apple", "a4:c3:f0": "Apple",
	// Samsung (phones/TVs)
	"00:12:fb": "Samsung", "00:15:99": "Samsung", "00:16:32": "Samsung",
	"00:17:c9": "Samsung", "00:1a:8a": "Samsung", "00:1b:98": "Samsung",
	"00:1d:25": "Samsung", "00:1e:7d": "Samsung", "00:21:19": "Samsung",
	"8c:71:f8": "Samsung", "8c:77:12": "Samsung", "94:35:0a": "Samsung",
	// Google / Pixel / Nest
	"00:1a:11": "Google", "54:60:09": "Google", "f4:f5:e8": "Google",
	"94:eb:2c": "Google", "48:d6:d5": "Google", "3c:5a:b4": "Google",
	// Amazon Echo/Fire
	"00:bb:3a": "Amazon", "40:b4:cd": "Amazon", "74:75:48": "Amazon",
	"84:d6:d0": "Amazon", "a0:02:dc": "Amazon", "b4:7c:9c": "Amazon",
	// Raspberry Pi
	"b8:27:eb": "Raspberry Pi", "dc:a6:32": "Raspberry Pi", "e4:5f:01": "Raspberry Pi",
}

type DiscoveredDevice struct {
	IP         string `json:"ip"`
	MAC        string `json:"mac"`
	Port       int    `json:"port"`
	Ports      []int  `json:"ports"`
	Brand      string `json:"brand"`
	DeviceType string `json:"device_type"`
	SSID       string `json:"ssid"`
	Online     bool   `json:"online"`
}

type HeartbeatPayload struct {
	Type string        `json:"type"`
	Data HeartbeatData `json:"data"`
}
type HeartbeatData struct {
	Agent       string `json:"agent"`
	Host        string `json:"host"`
	SSID        string `json:"ssid"`
	LocalIP     string `json:"local_ip"`
	LocalSubnet string `json:"local_subnet"`
	CamerasFound int   `json:"cameras_found"`
	Version     string `json:"version"`
	Status      string `json:"status"`
}

type DiscoveryPayload struct {
	Type string             `json:"type"`
	Data []DiscoveredDevice `json:"data"`
}

var (
	debugMode bool
	onceMode  bool
	lastFound int
)

// buildExcludedIPs reads gateway/DNS/DHCP addresses from the OS so we never
// misclassify a router or DNS server as a camera.
func buildExcludedIPs() map[string]bool {
	excluded := map[string]bool{}

	var out []byte
	var err error

	if runtime.GOOS == "windows" {
		out, err = exec.Command("ipconfig", "/all").Output()
	} else {
		out, _ = exec.Command("sh", "-c", "ip route 2>/dev/null || netstat -rn 2>/dev/null").Output()
		dns, _ := exec.Command("sh", "-c", "cat /etc/resolv.conf 2>/dev/null").Output()
		out = append(out, dns...)
	}

	if err == nil && len(out) > 0 {
		for _, line := range strings.Split(string(out), "\n") {
			l := strings.ToLower(line)
			if strings.Contains(l, "gateway") || strings.Contains(l, "default") ||
				strings.Contains(l, "dhcp") || strings.Contains(l, "dns") ||
				strings.Contains(l, "nameserver") {
				// Extract any IPv4 address from this line
				for _, field := range strings.Fields(line) {
					field = strings.TrimRight(field, ",;")
					if ip := net.ParseIP(field); ip != nil && ip.To4() != nil {
						excluded[ip.String()] = true
					}
				}
			}
		}
	}

	if debugMode && len(excluded) > 0 {
		ips := []string{}
		for k := range excluded { ips = append(ips, k) }
		fmt.Printf("[DEBUG] Infrastructure IPs excluded from results: %v\n", ips)
	}

	return excluded
}

func getNetworkInterfaces() []struct{ Name, IP, MAC, Subnet string } {
	type iface struct{ Name, IP, MAC, Subnet string }
	result := []iface{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return result
	}
	skip := []string{"lo", "loopback", "virtual", "vmware", "vbox", "docker", "tunnel", "tap", "tun", "bluetooth"}
	for _, i := range ifaces {
		name := strings.ToLower(i.Name)
		skipped := false
		for _, p := range skip {
			if strings.Contains(name, p) {
				skipped = true
				break
			}
		}
		if skipped || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
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
			if ip.To4()[0] == 169 {
				continue
			}
			subnet := ""
			if mask != nil {
				ones, _ := mask.Size()
				parts := strings.Split(ip.String(), ".")
				subnet = fmt.Sprintf("%s.%s.%s.0/%d", parts[0], parts[1], parts[2], ones)
			}
			result = append(result, iface{Name: i.Name, IP: ip.String(), MAC: i.HardwareAddr.String(), Subnet: subnet})
		}
	}
	return result
}

func getLocalIP() string {
	i := getNetworkInterfaces()
	if len(i) > 0 {
		return i[0].IP
	}
	return ""
}

func getLocalSubnet() string {
	i := getNetworkInterfaces()
	if len(i) > 0 {
		return i[0].Subnet
	}
	return ""
}

func getSubnetBase() string {
	ip := getLocalIP()
	if ip == "" {
		return ""
	}
	parts := strings.Split(ip, ".")
	if len(parts) >= 3 {
		return strings.Join(parts[:3], ".")
	}
	return ""
}

func getSSID() string {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("netsh", "wlan", "show", "interfaces")
	case "darwin":
		cmd = exec.Command("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport", "-I")
	default:
		out, err := exec.Command("iwgetid", "-r").Output()
		if err == nil {
			if s := strings.TrimSpace(string(out)); s != "" {
				return s
			}
		}
		cmd = exec.Command("sh", "-c", "nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2")
	}
	out, err := cmd.Output()
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
	if s := strings.TrimSpace(string(out)); s != "" {
		return s
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

// getMACForIP pings the IP to warm the ARP cache, then reads the ARP table.
// Must be called AFTER a successful port probe so the OS already has the entry.
func getMACForIP(ip string) string {
	// Fire a quick ping to ensure ARP cache entry exists
	switch runtime.GOOS {
	case "windows":
		exec.Command("ping", "-n", "1", "-w", "300", ip).Run()
	default:
		exec.Command("ping", "-c", "1", "-W", "1", ip).Run()
	}

	// Read ARP table for this specific IP
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("arp", "-a", ip)
	} else {
		cmd = exec.Command("sh", "-c", fmt.Sprintf("arp -n %s 2>/dev/null || arp %s 2>/dev/null", ip, ip))
	}

	out, err := cmd.Output()
	if err != nil {
		return ""
	}

	for _, line := range strings.Split(string(out), "\n") {
		for _, field := range strings.Fields(line) {
			norm := strings.ToLower(strings.ReplaceAll(field, "-", ":"))
			if strings.Count(norm, ":") == 5 && len(norm) >= 17 && norm != "ff:ff:ff:ff:ff:ff" {
				return norm
			}
		}
	}
	return ""
}

// classifyDevice returns device_type based on open ports and brand
func classifyDevice(openPorts []int, brand string) string {
	for _, p := range openPorts {
		if p == 62078 || p == 5555 {
			return "phone"
		}
	}
	lower := strings.ToLower(brand)
	if strings.Contains(lower, "apple") || strings.Contains(lower, "samsung") ||
		strings.Contains(lower, "google") {
		return "phone"
	}
	return "ip_camera"
}

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

func sweepSubnet(excluded map[string]bool) []DiscoveredDevice {
	base := getSubnetBase()
	if base == "" {
		return nil
	}
	ips := make([]string, 254)
	for i := range ips {
		ips[i] = fmt.Sprintf("%s.%d", base, i+1)
	}
	ssid := getSSID()
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
			// Skip infrastructure IPs (gateway, DNS, DHCP)
			if excluded[r.d.IP] {
				if debugMode {
					fmt.Printf("[DEBUG] Skipping infrastructure IP: %s\n", r.d.IP)
				}
				continue
			}

			// POST-PROBE: get MAC now that ARP cache is warm from the TCP connection
			mac := getMACForIP(r.d.IP)
			r.d.MAC = mac
			r.d.SSID = ssid
			r.d.Online = true

			// OUI lookup with populated MAC
			brand := lookupOUI(mac)
			if brand == "" {
				brand = "Unknown"
			}
			r.d.Brand = brand
			r.d.DeviceType = classifyDevice(r.d.Ports, brand)

			devices = append(devices, *r.d)
		}
	}
	return devices
}

func postJSON(payload interface{}) string {
	body, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("POST", ReportURL, bytes.NewBuffer(body))
	if err != nil {
		return "request error: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "network error: " + err.Error()
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	buf.ReadFrom(resp.Body)
	return buf.String()
}

func sendHeartbeat(camerasFound int) {
	h, _ := os.Hostname()
	postJSON(HeartbeatPayload{Type: "heartbeat", Data: HeartbeatData{
		Agent:        "discovery",
		Host:         h,
		SSID:         getSSID(),
		LocalIP:      getLocalIP(),
		LocalSubnet:  getLocalSubnet(),
		CamerasFound: camerasFound,
		Version:      Version,
		Status:       "running",
	}})
	if debugMode {
		fmt.Printf("[%s] [HB] sent\n", time.Now().Format("15:04:05"))
	}
}

func scan(excluded map[string]bool) int {
	ip := getLocalIP()
	ssid := getSSID()
	subnet := getLocalSubnet()
	fmt.Printf("[%s] Scanning %s  SSID=%s  IP=%s\n", time.Now().Format("15:04:05"), subnet, ssid, ip)
	devices := sweepSubnet(excluded)
	fmt.Printf("[%s] Found %d devices\n", time.Now().Format("15:04:05"), len(devices))

	if debugMode {
		for _, d := range devices {
			fmt.Printf("  -> %s  MAC=%s  Brand=%s  Type=%s  Ports=%v\n", d.IP, d.MAC, d.Brand, d.DeviceType, d.Ports)
		}
	}

	if len(devices) > 0 {
		body, _ := json.Marshal(DiscoveryPayload{Type: "discovery", Data: devices})
		client := &http.Client{Timeout: 15 * time.Second}
		req, _ := http.NewRequest("POST", ReportURL, bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		client.Do(req)
	}
	return len(devices)
}

func main() {
	flag.BoolVar(&debugMode, "debug", false, "Verbose output including per-device brand/MAC")
	flag.BoolVar(&onceMode, "once", false, "Single scan then exit")
	flag.Parse()

	h, _ := os.Hostname()
	fmt.Printf("RealSecCam Observer v%s  host=%s  ip=%s  ssid=%s\n", Version, h, getLocalIP(), getSSID())

	// Build excluded list once at startup
	excluded := buildExcludedIPs()
	fmt.Printf("Infrastructure IPs excluded from results: %v\n", func() []string {
		ips := []string{}
		for k := range excluded { ips = append(ips, k) }
		return ips
	}())

	sendHeartbeat(0)
	lastFound = scan(excluded)
	sendHeartbeat(lastFound)

	if onceMode {
		return
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	scanTick := time.NewTicker(ScanIntervalSec * time.Second)
	hbTick := time.NewTicker(HeartbeatIntervalSec * time.Second)
	fmt.Printf("Watching... Ctrl+C to stop\n")

	for {
		select {
		case <-scanTick.C:
			lastFound = scan(excluded)
		case <-hbTick.C:
			sendHeartbeat(lastFound)
		case <-sig:
			fmt.Println("Stopping.")
			return
		}
	}
}
