// RealSecCam Observer v1.2 - Native Discovery Agent
// Single self-contained binary. No dependencies.
//
// Build (handled automatically by GitHub Actions):
//   Windows (no console): GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H=windowsgui" -o RealSecCam-Observer-Windows.exe observer.go
//   macOS:  GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-macOS   observer.go
//   Linux:  GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-Linux    observer.go

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
	Version              = "1.2.0"
	ReportURL            = "https://accelerated-sync-dev-flow.base44.app/functions/agentReport"
	ScanIntervalSec      = 30
	HeartbeatIntervalSec = 15
	PortScanTimeoutMs    = 800
	MaxConcurrentProbes  = 40
)

// CameraPorts: standard IP camera + mobile device discovery ports.
// 554/8554 = RTSP, 80/8080/8000 = HTTP admin panel,
// 62078 = iPhone lockdown/sync (Apple), 5353 = mDNS/Bonjour (iPhone/Android/IoT),
// 5555 = Android ADB debug, 8888 = common IP cam HTTP alt
var CameraPorts = []int{554, 8554, 8080, 80, 8000, 62078, 5353, 5555, 8888}

// OUITable maps the first 3 octets of a MAC address to manufacturer name.
// Expanded with common camera, phone, and IoT vendors.
var OUITable = map[string]string{
	// IP Camera vendors
	"00:23:63": "Hikvision",    "bc:ad:28": "Hikvision",    "4c:bd:8f": "Hikvision",
	"8c:e7:48": "Hikvision",    "a0:8c:f8": "Hikvision",    "c0:56:e3": "Hikvision",
	"28:57:be": "Dahua",        "3c:ef:8c": "Dahua",         "e0:50:8b": "Dahua",
	"c8:d5:fe": "Reolink",      "ec:71:db": "Reolink",       "d4:93:90": "Reolink",
	"e4:24:6c": "Reolink",      "b0:c5:ca": "Wyze",          "f4:f2:6d": "Amcrest",
	"00:62:6e": "Foscam",       "9c:8e:cd": "TP-Link Tapo",  "1c:61:b4": "Arlo",
	"70:56:81": "Ring",         "b4:e6:2d": "Axis",          "b8:a4:4f": "Hanwha",
	"b0:be:76": "Eufy",         "5c:aa:fd": "Eufy",          "d0:14:11": "Eufy",
	"00:0f:df": "FLIR",         "00:40:8c": "Axis",          "ac:cc:8e": "Uniview",
	"9c:b6:d0": "Uniview",      "3c:cd:57": "Dahua",
	// Mobile / Apple / Android
	"00:17:f2": "Apple",        "00:1b:63": "Apple",         "00:1c:b3": "Apple",
	"00:1d:4f": "Apple",        "00:1e:52": "Apple",         "00:1f:5b": "Apple",
	"00:21:e9": "Apple",        "00:22:41": "Apple",         "00:23:12": "Apple",
	"00:23:32": "Apple",        "00:23:6c": "Apple",         "00:24:36": "Apple",
	"00:25:00": "Apple",        "00:25:4b": "Apple",         "00:25:bc": "Apple",
	"00:26:08": "Apple",        "00:26:4a": "Apple",         "00:26:b0": "Apple",
	"00:26:bb": "Apple",        "3c:07:54": "Apple",         "a4:5e:60": "Apple",
	"a8:86:dd": "Apple",        "ac:29:3a": "Apple",         "b8:e8:56": "Apple",
	"c8:2a:14": "Apple",        "d8:a2:5e": "Apple",         "e0:f8:47": "Apple",
	"f0:d1:a9": "Apple",        "f4:f1:5a": "Apple",
	// Samsung (Android)
	"00:07:ab": "Samsung",      "00:12:47": "Samsung",       "00:15:b9": "Samsung",
	"00:17:c9": "Samsung",      "00:1a:8a": "Samsung",       "8c:77:12": "Samsung",
	"94:35:0a": "Samsung",      "b4:3a:28": "Samsung",       "cc:07:ab": "Samsung",
	// Google / Pixel / Nest
	"f4:f5:d8": "Google",       "48:d6:d5": "Google",        "3c:5a:b4": "Google",
	"d4:f5:47": "Google",       "00:1a:11": "Google",
	// IoT / Smart Home
	"50:c7:bf": "TP-Link",      "60:32:b1": "TP-Link",       "98:da:c4": "TP-Link",
	"18:d6:c7": "TP-Link",      "e8:de:27": "TP-Link",
	"74:da:38": "Edimax",       "00:e0:4c": "Realtek",
	"dc:a6:32": "Raspberry Pi", "b8:27:eb": "Raspberry Pi",  "e4:5f:01": "Raspberry Pi",
	"10:62:eb": "Amazon Echo",  "40:b4:cd": "Amazon Echo",   "f0:27:2d": "Amazon Echo",
}

// NetworkIface is defined at package level so all functions share the same type.
type NetworkIface struct {
	Name   string
	IP     string
	MAC    string
	Subnet string
}

type DiscoveredDevice struct {
	IP           string `json:"ip"`
	MAC          string `json:"mac"`
	Port         int    `json:"port"`
	Ports        []int  `json:"ports"`
	Brand        string `json:"brand"`
	SSID         string `json:"ssid"`
	Online       bool   `json:"online"`
	DeviceType   string `json:"device_type"`
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

var (
	debugMode    bool
	onceMode     bool
	lastFound    int
	excludedIPs  = map[string]bool{} // gateways, DHCP servers, DNS servers
)

// getNetworkInterfaces returns active non-loopback IPv4 interfaces.
func getNetworkInterfaces() []NetworkIface {
	result := []NetworkIface{}
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
			result = append(result, NetworkIface{Name: i.Name, IP: ip.String(), MAC: i.HardwareAddr.String(), Subnet: subnet})
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

// buildExcludedIPs parses routing/network config to identify infrastructure IPs
// (gateway, DHCP server, DNS servers) that should never be reported as cameras.
// Verified approach: parse OS routing table output — industry standard for Go
// since golang.org/x/net/route is BSD-only (confirmed: reddit.com/r/golang/6pfkth).
func buildExcludedIPs() {
	excludedIPs = map[string]bool{}

	var lines []string
	switch runtime.GOOS {
	case "windows":
		// ipconfig /all gives gateway, DHCP server, DNS servers per adapter
		out, err := exec.Command("ipconfig", "/all").Output()
		if err == nil {
			lines = strings.Split(string(out), "\n")
			for _, line := range lines {
				l := strings.TrimSpace(line)
				// Match: "Default Gateway . . . : 192.168.0.1"
				//        "DHCP Server . . . . . : 192.168.0.1"
				//        "DNS Servers . . . . . : 192.168.0.1"
				if strings.Contains(l, "Default Gateway") ||
					strings.Contains(l, "DHCP Server") ||
					strings.Contains(l, "DNS Servers") {
					// Value is after the last ":"
					if idx := strings.LastIndex(l, ":"); idx >= 0 {
						candidate := strings.TrimSpace(l[idx+1:])
						// Strip trailing scope id if any (e.g. %16)
						if pct := strings.Index(candidate, "%"); pct >= 0 {
							candidate = candidate[:pct]
						}
						if net.ParseIP(candidate) != nil && strings.Contains(candidate, ".") {
							excludedIPs[candidate] = true
						}
					}
				}
			}
		}
	default:
		// Linux / macOS: use "ip route" first, fall back to "route -n" / "netstat -rn"
		out, err := exec.Command("sh", "-c", "ip route 2>/dev/null || route -n 2>/dev/null || netstat -rn 2>/dev/null").Output()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				fields := strings.Fields(line)
				// "ip route" default line: "default via 192.168.0.1 dev ..."
				// "route -n" default line: "0.0.0.0  192.168.0.1  ..."
				for i, f := range fields {
					if (f == "via" || f == "gateway" || f == "Gateway") && i+1 < len(fields) {
						candidate := fields[i+1]
						if net.ParseIP(candidate) != nil && strings.Contains(candidate, ".") {
							excludedIPs[candidate] = true
						}
					}
				}
			}
		}
		// Also parse /etc/resolv.conf for DNS servers on Linux
		if data, err := os.ReadFile("/etc/resolv.conf"); err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "nameserver") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						if net.ParseIP(fields[1]) != nil && strings.Contains(fields[1], ".") {
							excludedIPs[fields[1]] = true
						}
					}
				}
			}
		}
	}

	if debugMode {
		fmt.Printf("[INFRA] Excluded infrastructure IPs: %v\n", excludedIPs)
	}
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

// getARPTable reads the system ARP cache.
// Linux: reads /proc/net/arp directly (no exec, faster, no parse failures).
// Windows/macOS: runs "arp -a" and parses output.
// Key insight (confirmed via stackoverflow/13778035 and groups.google.com/golang-nuts):
// ARP cache is only populated AFTER a connection attempt, so we call this
// AFTER port probing, not before.
func getARPTable() map[string]string {
	m := map[string]string{}

	if runtime.GOOS == "linux" {
		// /proc/net/arp is more reliable than exec on Linux - no parse ambiguity
		data, err := os.ReadFile("/proc/net/arp")
		if err == nil {
			for i, line := range strings.Split(string(data), "\n") {
				if i == 0 {
					continue // skip header
				}
				fields := strings.Fields(line)
				if len(fields) >= 4 {
					ip := fields[0]
					mac := strings.ToLower(fields[3])
					if mac != "00:00:00:00:00:00" && mac != "ff:ff:ff:ff:ff:ff" {
						m[ip] = mac
					}
				}
			}
			return m
		}
	}

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

// getMACForIP forces ARP resolution for a specific IP by pinging it first,
// then reading the ARP cache for that specific address.
// This fixes the "blank OUI" problem where the cache was read before the OS
// resolved the MAC (confirmed: stackoverflow.com/25404485, golang-nuts/Q2ga6XOqzRc).
func getMACForIP(ip string) string {
	// Brief ping to populate ARP cache (1 packet, 500ms timeout)
	switch runtime.GOOS {
	case "windows":
		exec.Command("ping", "-n", "1", "-w", "500", ip).Run()
		// Query ARP for this specific IP
		out, err := exec.Command("arp", "-a", ip).Output()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				for _, f := range strings.Fields(line) {
					if (strings.Count(f, ":") == 5 || strings.Count(f, "-") == 5) && len(f) >= 17 {
						mac := strings.ToLower(strings.ReplaceAll(f, "-", ":"))
						if mac != "ff:ff:ff:ff:ff:ff" {
							return mac
						}
					}
				}
			}
		}
	case "linux":
		exec.Command("ping", "-c", "1", "-W", "1", ip).Run()
		if data, err := os.ReadFile("/proc/net/arp"); err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				fields := strings.Fields(line)
				if len(fields) >= 4 && fields[0] == ip {
					mac := strings.ToLower(fields[3])
					if mac != "00:00:00:00:00:00" && mac != "ff:ff:ff:ff:ff:ff" {
						return mac
					}
				}
			}
		}
	default: // macOS
		exec.Command("ping", "-c", "1", "-W", "500", ip).Run()
		out, err := exec.Command("arp", "-n", ip).Output()
		if err == nil {
			for _, f := range strings.Fields(string(out)) {
				if strings.Count(f, ":") == 5 && len(f) >= 17 {
					return strings.ToLower(f)
				}
			}
		}
	}
	return ""
}

// classifyDevice infers whether a device is a camera, phone, or generic IoT
// based on the open ports found and OUI brand name.
func classifyDevice(openPorts []int, brand string) string {
	rtspFound := false
	mobileFound := false
	for _, p := range openPorts {
		if p == 554 || p == 8554 {
			rtspFound = true
		}
		if p == 62078 || p == 5555 {
			mobileFound = true
		}
	}
	if rtspFound {
		return "ip_camera"
	}
	if mobileFound {
		return "phone"
	}
	bl := strings.ToLower(brand)
	if strings.Contains(bl, "apple") || strings.Contains(bl, "samsung") || strings.Contains(bl, "google") {
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

// probeDevice checks all CameraPorts on the target IP concurrently.
// Returns nil if no ports are open (device is not interesting).
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

func sweepSubnet() []DiscoveredDevice {
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

			// === GATEWAY / INFRASTRUCTURE FILTER ===
			// Skip routers, DHCP servers, DNS servers — they respond to ports
			// but are definitively NOT cameras. Built from ipconfig/ip route output.
			if excludedIPs[r.d.IP] {
				if debugMode {
					fmt.Printf("[SKIP] %s is infrastructure (gateway/DHCP/DNS) — excluded\n", r.d.IP)
				}
				continue
			}

			// === POST-PROBE MAC LOOKUP ===
			// We call getMACForIP AFTER confirming open ports so the OS has already
			// had TCP connections to this IP, making ARP resolution reliable.
			// (Pre-probe ARP lookup was the root cause of empty brand labels.)
			mac := getMACForIP(r.d.IP)
			if mac == "" {
				// Fallback: check pre-existing ARP table
				mac = getARPTable()[r.d.IP]
			}
			r.d.MAC = mac
			r.d.SSID = ssid
			r.d.Online = true

			brand := lookupOUI(mac)
			if brand == "" {
				brand = "IP Camera"
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
		Agent: "discovery", Host: h, SSID: getSSID(),
		LocalIP: getLocalIP(), LocalSubnet: getLocalSubnet(),
		CamerasFound: camerasFound, Version: Version, Status: "running",
	}})
	if debugMode {
		fmt.Printf("[%s] [HB] sent\n", time.Now().Format("15:04:05"))
	}
}

func scan() int {
	ip := getLocalIP()
	ssid := getSSID()
	subnet := getLocalSubnet()
	fmt.Printf("[%s] Scanning %s  SSID=%s  IP=%s\n", time.Now().Format("15:04:05"), subnet, ssid, ip)
	devices := sweepSubnet()
	fmt.Printf("[%s] Found %d devices\n", time.Now().Format("15:04:05"), len(devices))
	if debugMode && len(devices) > 0 {
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
	flag.BoolVar(&debugMode, "debug", false, "Verbose output")
	flag.BoolVar(&onceMode, "once", false, "Single scan then exit")
	flag.Parse()

	h, _ := os.Hostname()

	// Build infrastructure exclusion list FIRST using ipconfig/ip route
	buildExcludedIPs()

	fmt.Printf("RealSecCam Observer v%s  host=%s  ip=%s  ssid=%s\n", Version, h, getLocalIP(), getSSID())
	fmt.Printf("Infrastructure IPs excluded from results: %v\n", func() []string {
		keys := []string{}
		for k := range excludedIPs {
			keys = append(keys, k)
		}
		return keys
	}())

	sendHeartbeat(0)
	lastFound = scan()
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
			lastFound = scan()
		case <-hbTick.C:
			sendHeartbeat(lastFound)
		case <-sig:
			fmt.Println("Stopping.")
			return
		}
	}
}
