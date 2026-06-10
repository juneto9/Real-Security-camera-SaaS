//go:build windows
// +build windows

package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const CREATE_NO_WINDOW = 0x08000000

// runHidden runs a subprocess completely invisible — no taskbar entry, no CMD flash.
// Uses CREATE_NO_WINDOW which is the definitive Windows API flag for this.
func runHidden(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: CREATE_NO_WINDOW,
		HideWindow:    true,
	}
	cmd.Run()
}

// runHiddenOutput runs a subprocess invisibly and returns its stdout.
func runHiddenOutput(name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: CREATE_NO_WINDOW,
		HideWindow:    true,
	}
	return cmd.Output()
}

// detectSSID reads the current WiFi SSID via netsh, fully hidden.
func detectSSID() string {
	out, err := runHiddenOutput("netsh", "wlan", "show", "interfaces")
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
	return "(wired)"
}

// getARPTable reads the ARP cache using pure Go — zero subprocesses, zero CMD windows.
// It pings each host on the subnet briefly to populate the OS ARP cache first,
// then reads it back via the Windows IP Helper API through a small UDP trick.
// For simplicity and reliability we use the standard "arp -a" but fully hidden.
func getARPTable() map[string]string {
	m := map[string]string{}
	out, err := runHiddenOutput("arp", "-a")
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

// showInstallNotification shows a foreground MessageBox via PowerShell.
// PowerShell's Add-Type + MessageBox reliably comes to foreground on all Windows versions.
func showInstallNotification() {
	ps := `Add-Type -AssemblyName System.Windows.Forms; `[System.Windows.Forms.MessageBox]::Show("RealSecCam Observer v1.9.0 is now running.`\`n`\`nYour cameras will appear in the dashboard automatically.`\`n`\`nThis window won't appear again — Observer runs quietly in the background.", "RealSecCam Observer", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)``
	cmd := exec.Command("powershell", "-WindowStyle", "Hidden", "-NonInteractive", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: CREATE_NO_WINDOW,
		HideWindow:    true,
	}
	cmd.Start()
}

// Unused imports stub — keep compiler happy on Windows build
var _ = fmt.Sprintf
var _ = net.ParseIP
var _ = http.NewServeMux
var _ = os.Getenv
var _ = time.Now
var _ = unsafe.Pointer(nil)
