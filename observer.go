// RealSecCam Observer v1.1 - Native Discovery Agent
// Single self-contained binary. No dependencies.
//
// Build (handled automatically by GitHub Actions):
//   GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-Windows.exe observer.go
//   GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-macOS   observer.go
//   GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o RealSecCam-Observer-Linux    observer.go

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
	Version              = "1.1.0"
	ReportURL            = "https://accelerated-sync-dev-flow.base44.app/functions/agentReport"
	ScanIntervalSec      = 30
	HeartbeatIntervalSec = 15
	PortScanTimeoutMs    = 800
	MaxConcurrentProbes  = 40
)

var CameraPorts = []int{554, 8554, 8080, 80, 8000}

var OUITable = map[string]string{
	"00:23:63": "Hikvision", "bc:ad:28": "Hikvision", "4c:bd:8f": "Hikvision",
	"8c:e7:48": "Hikvision", "a0:8c:f8": "Hikvision", "28:57:be": "Dahua",
	"3c:ef:8c": "Dahua",     "e0:50:8b": "Dahua",     "c8:d5:fe": "Reolink",
	"ec:71:db": "Reolink",   "b0:c5:ca": "Wyze",      "f4:f2:6d": "Amcrest",
	"00:62:6e": "Foscam",    "9c:8e:cd": "TP-Link Tapo", "1c:61:b4": "Arlo",
	"70:56:81": "Ring",      "b4:e6:2d": "Axis",      "b8:a4:4f": "Hanwha",
	"b0:be:76": "Eufy",      "5c:aa:fd": "Eufy",      "d4:93:90": "Reolink",
	"e4:24:6c": "Reolink",
}

// NetworkIface is defined at package level so all functions share the same type.
type NetworkIface struct {
	Name   string
	IP     string
	MAC    string
	Subnet string
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

var (
	debugMode bool
	onceMode  bool
	lastFound int
)

func getNetworkInterfaces() []NetworkIface {
	result := []NetworkIface{}
	ifaces, err := net.Interfaces()
	if err != nil { return result }
	skip := []string{"lo","loopback","virtual","vmware","vbox","docker","tunnel","tap","tun","bluetooth"}
	for _, i := range ifaces {
		name := strings.ToLower(i.Name)
		skipped := false
		for _, p := range skip { if strings.Contains(name, p) { skipped = true; break } }
		if skipped || i.Flags&net.FlagLoopback != 0 { continue }
		addrs, _ := i.Addrs()
		for _, addr := range addrs {
			var ip net.IP; var mask net.IPMask
			switch v := addr.(type) {
			case *net.IPNet:  ip = v.IP; mask = v.Mask
			case *net.IPAddr: ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.To4() == nil { continue }
			if ip.To4()[0] == 169 { continue }
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
	ifaces := getNetworkInterfaces()
	if len(ifaces) > 0 { return ifaces[0].IP }
	return ""
}
func getLocalSubnet() string {
	ifaces := getNetworkInterfaces()
	if len(ifaces) > 0 { return ifaces[0].Subnet }
	return ""
}
func getSubnetBase() string {
	ip := getLocalIP()
	if ip == "" { return "" }
	parts := strings.Split(ip, ".")
	if len(parts) >= 3 { return strings.Join(parts[:3], ".") }
	return ""
}

func getSSID() string {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("netsh", "wlan", "show", "interfaces")
	case "darwin":
		out, err := exec.Command("sh", "-c", "networksetup -getairportnetwork en0 2>/dev/null | awk -F': ' '{print $2}'").Output()
		if err == nil { if s := strings.TrimSpace(string(out)); s != "" && s != "You are not associated" { return s } }
		cmd = exec.Command("sh", "-c", "ipconfig getsummary en0 2>/dev/null | grep SSID | tail -1 | awk '{print $NF}'")
	default:
		out, err := exec.Command("iwgetid", "-r").Output()
		if err == nil { if s := strings.TrimSpace(string(out)); s != "" { return s } }
		cmd = exec.Command("sh", "-c", "nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2")
	}
	out, err := cmd.Output()
	if err != nil { return "(wired)" }
	for _, line := range strings.Split(string(out), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "SSID") && !strings.HasPrefix(t, "BSSID") {
			if parts := strings.SplitN(t, ":", 2); len(parts) == 2 { return strings.TrimSpace(parts[1]) }
		}
	}
	if s := strings.TrimSpace(string(out)); s != "" { return s }
	return "(wired)"
}

func lookupOUI(mac string) string {
	if mac == "" { return "" }
	n := strings.ToLower(strings.ReplaceAll(mac, "-", ":"))
	if parts := strings.Split(n, ":"); len(parts) >= 3 {
		if brand, ok := OUITable[strings.Join(parts[:3], ":")]; ok { return brand }
	}
	return ""
}

func getARPTable() map[string]string {
	m := map[string]string{}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" { cmd = exec.Command("arp", "-a") } else { cmd = exec.Command("sh", "-c", "arp -n 2>/dev/null || arp -a 2>/dev/null") }
	out, err := cmd.Output()
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

func probePort(ip string, port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), time.Duration(PortScanTimeoutMs)*time.Millisecond)
	if err != nil { return false }
	conn.Close(); return true
}

func probeDevice(ip string) *DiscoveredDevice {
	type res struct{ port int; open bool }
	results := make([]res, len(CameraPorts))
	var wg sync.WaitGroup
	for i, p := range CameraPorts {
		wg.Add(1)
		go func(idx, port int) { defer wg.Done(); results[idx] = res{port, probePort(ip, port)} }(i, p)
	}
	wg.Wait()
	open := []int{}
	for _, r := range results { if r.open { open = append(open, r.port) } }
	if len(open) == 0 { return nil }
	return &DiscoveredDevice{IP: ip, Port: open[0], Ports: open}
}

func sweepSubnet() []DiscoveredDevice {
	base := getSubnetBase()
	if base == "" { return nil }
	ips := make([]string, 254)
	for i := range ips { ips[i] = fmt.Sprintf("%s.%d", base, i+1) }
	arp := getARPTable()
	ssid := getSSID()
	devices := []DiscoveredDevice{}
	for i := 0; i < len(ips); i += MaxConcurrentProbes {
		end := i + MaxConcurrentProbes
		if end > len(ips) { end = len(ips) }
		type br struct{ d *DiscoveredDevice }
		batch := make([]br, end-i)
		var wg sync.WaitGroup
		for j, ip := range ips[i:end] {
			wg.Add(1)
			go func(idx int, tip string) { defer wg.Done(); batch[idx] = br{probeDevice(tip)} }(j, ip)
		}
		wg.Wait()
		for _, r := range batch {
			if r.d == nil { continue }
			mac := arp[r.d.IP]; r.d.MAC = mac; r.d.SSID = ssid; r.d.Online = true
			if b := lookupOUI(mac); b != "" { r.d.Brand = b } else { r.d.Brand = "IP Camera" }
			devices = append(devices, *r.d)
		}
	}
	return devices
}

func postJSON(payload interface{}) string {
	body, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("POST", ReportURL, bytes.NewBuffer(body))
	if err != nil { return "request error: " + err.Error() }
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil { return "network error: " + err.Error() }
	defer resp.Body.Close()
	buf := new(bytes.Buffer); buf.ReadFrom(resp.Body)
	return buf.String()
}

func sendHeartbeat(camerasFound int) {
	h, _ := os.Hostname()
	postJSON(HeartbeatPayload{Type: "heartbeat", Data: HeartbeatData{
		Agent: "discovery", Host: h, SSID: getSSID(),
		LocalIP: getLocalIP(), LocalSubnet: getLocalSubnet(),
		CamerasFound: camerasFound, Version: Version, Status: "running",
	}})
	if debugMode { fmt.Printf("[%s] [HB] sent\n", time.Now().Format("15:04:05")) }
}

func scan() int {
	ip := getLocalIP(); ssid := getSSID(); subnet := getLocalSubnet()
	fmt.Printf("[%s] Scanning %s  SSID=%s  IP=%s\n", time.Now().Format("15:04:05"), subnet, ssid, ip)
	devices := sweepSubnet()
	fmt.Printf("[%s] Found %d devices\n", time.Now().Format("15:04:05"), len(devices))
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
	fmt.Printf("RealSecCam Observer v%s  host=%s  ip=%s  ssid=%s\n", Version, h, getLocalIP(), getSSID())
	sendHeartbeat(0)
	lastFound = scan()
	sendHeartbeat(lastFound)
	if onceMode { return }
	sig := make(chan os.Signal, 1); signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	scanTick := time.NewTicker(ScanIntervalSec * time.Second)
	hbTick   := time.NewTicker(HeartbeatIntervalSec * time.Second)
	fmt.Printf("Watching... Ctrl+C to stop\n")
	for {
		select {
		case <-scanTick.C: lastFound = scan()
		case <-hbTick.C:  sendHeartbeat(lastFound)
		case <-sig:       fmt.Println("Stopping."); return
		}
	}
}
