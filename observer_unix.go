//go:build !windows
// +build !windows

package main

import (
	"net"
	"os/exec"
	"strings"
)

// runHidden on non-Windows is just a normal exec (no console to hide).
func runHidden(name string, args ...string) {
	exec.Command(name, args...).Run()
}

func runHiddenOutput(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

func detectSSID() string {
	switch detectOS() {
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
		out, _ = exec.Command("sh", "-c", "nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2").Output()
		if s := strings.TrimSpace(string(out)); s != "" {
			return s
		}
	}
	return "(wired)"
}

func detectOS() string {
	out, _ := exec.Command("uname").Output()
	s := strings.ToLower(strings.TrimSpace(string(out)))
	if strings.Contains(s, "darwin") {
		return "darwin"
	}
	return "linux"
}

func getARPTable() map[string]string {
	m := map[string]string{}
	out, err := exec.Command("sh", "-c", "arp -n 2>/dev/null || arp -a 2>/dev/null").Output()
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

func showInstallNotification() {
	// No popup on macOS/Linux — runs silently as intended
}
