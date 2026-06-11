// RealSecCam Streamer v1.0.0
// Captures local webcam via FFmpeg and pushes RTSP to MediaMTX Cloud Relay.
// Reports hls_url back to dashboard so Live View works instantly.
//
// Architecture: [Webcam] → FFmpeg → RTSP → [MediaMTX Cloud] → HLS → [Dashboard]
//
// Build:
//   Windows: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o RealSecCam-Streamer-v1.0.0-Windows.exe .
//   macOS:   GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o RealSecCam-Streamer-v1.0.0-macOS .
//   Linux:   GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w"               -o RealSecCam-Streamer-v1.0.0-Linux .

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
	"time"
)

const (
	Version         = "1.0.0"
	ReportURL       = "https://accelerated-sync-dev-flow.base44.app/functions/agentReport"
	RelayHost       = "RELAY_HOST_PLACEHOLDER"
	RelayRTSPPort   = "8554"
	RelayHLSPort    = "8888"
	HeartbeatSec    = 15
)

type ReportPayload struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

var ffmpegProc *exec.Cmd

func logf(format string, args ...interface{}) {
	fmt.Printf("["+time.Now().Format("15:04:05")+"] "+format+"\n", args...)
}

func getLocalIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil { return "" }
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func getLocalMAC() string {
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		if i.Flags&net.FlagLoopback != 0 || i.Flags&net.FlagUp == 0 { continue }
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ip, ok := a.(*net.IPNet); ok && ip.IP.To4() != nil && !ip.IP.IsLoopback() {
				return i.HardwareAddr.String()
			}
		}
	}
	return ""
}

func postJSON(payload interface{}) error {
	body, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("POST", ReportURL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil { return err }
	resp.Body.Close()
	return nil
}

// detectWebcamDevice returns the platform-appropriate FFmpeg device string.
func detectWebcamDevice() string {
	switch runtime.GOOS {
	case "windows":
		// DirectShow — first available video device
		return "video=0"
	case "darwin":
		return "0"
	default:
		// Linux — try /dev/video0..3
		for i := 0; i < 4; i++ {
			dev := fmt.Sprintf("/dev/video%d", i)
			if _, err := os.Stat(dev); err == nil { return dev }
		}
		return "/dev/video0"
	}
}

// ffmpegInputArgs returns platform-specific input flags for webcam capture.
func ffmpegInputArgs(device string) []string {
	switch runtime.GOOS {
	case "windows":
		return []string{"-f", "dshow", "-i", device}
	case "darwin":
		return []string{"-f", "avfoundation", "-framerate", "30", "-i", device + ":none"}
	default:
		return []string{"-f", "v4l2", "-framerate", "30", "-i", device}
	}
}

func streamPath() string {
	h, _ := os.Hostname()
	h = strings.ToLower(strings.ReplaceAll(h, " ", "_"))
	return "cam_" + h
}

func rtspPushURL() string {
	return fmt.Sprintf("rtsp://%s:%s/%s", RelayHost, RelayRTSPPort, streamPath())
}

func hlsURL() string {
	return fmt.Sprintf("http://%s:%s/%s/index.m3u8", RelayHost, RelayHLSPort, streamPath())
}

func startFFmpeg() {
	device := detectWebcamDevice()
	inputArgs := ffmpegInputArgs(device)
	pushURL := rtspPushURL()

	args := append(inputArgs,
		"-vcodec", "libx264",
		"-preset", "ultrafast",
		"-tune", "zerolatency",
		"-b:v", "800k",
		"-bufsize", "800k",
		"-maxrate", "800k",
		"-g", "30",
		"-an",
		"-f", "rtsp",
		"-rtsp_transport", "tcp",
		pushURL,
	)

	logf("[Streamer] Starting FFmpeg: ffmpeg %s", strings.Join(args, " "))
	ffmpegProc = exec.Command("ffmpeg", args...)
	ffmpegProc.Stdout = os.Stdout
	ffmpegProc.Stderr = os.Stderr
	hiddenCmdPlatform(ffmpegProc)
	if err := ffmpegProc.Start(); err != nil {
		logf("[Streamer] FFmpeg start error: %v", err)
		return
	}
	logf("[Streamer] FFmpeg running PID=%d pushing to %s", ffmpegProc.Process.Pid, pushURL)
}

func stopFFmpeg() {
	if ffmpegProc != nil && ffmpegProc.Process != nil {
		ffmpegProc.Process.Kill()
		ffmpegProc = nil
	}
}

func watchFFmpeg() {
	for {
		if ffmpegProc == nil || ffmpegProc.Process == nil {
			logf("[Watchdog] FFmpeg not running — restarting in 5s")
			time.Sleep(5 * time.Second)
			startFFmpeg()
			continue
		}
		// Check if process is still alive by sending signal 0
		if err := ffmpegProc.Process.Signal(os.Signal(nil)); err != nil {
			logf("[Watchdog] FFmpeg died — restarting")
			ffmpegProc = nil
			continue
		}
		time.Sleep(10 * time.Second)
	}
}

func sendHeartbeat() {
	h, _ := os.Hostname()
	err := postJSON(ReportPayload{
		Type: "heartbeat",
		Data: map[string]interface{}{
			"agent":   "streamer",
			"host":    h,
			"version": Version,
			"local_ip": getLocalIP(),
			"status":  "running",
		},
	})
	if err != nil { logf("[HB] error: %v", err) }
}

func reportStream() {
	h, _ := os.Hostname()
	ip := getLocalIP()
	mac := getLocalMAC()
	hls := hlsURL()
	// Give MediaMTX 3s to ingest the RTSP before reporting the HLS URL
	time.Sleep(3 * time.Second)
	err := postJSON(ReportPayload{
		Type: "stream_update",
		Data: map[string]interface{}{
			"ip":         ip,
			"mac":        mac,
			"hls_url":    hls,
			"relay_host": RelayHost,
			"host":       h,
		},
	})
	if err != nil {
		logf("[Stream] report error: %v", err)
	} else {
		logf("[Stream] Reported HLS URL: %s", hls)
	}
}

func main() {
	h, _ := os.Hostname()
	logf("RealSecCam Streamer v%s  host=%s  ip=%s  relay=%s", Version, h, getLocalIP(), RelayHost)
	logf("Stream path: %s", streamPath())
	logf("RTSP push:   %s", rtspPushURL())
	logf("HLS output:  %s", hlsURL())

	registerAutostart()
	showNotification()

	startFFmpeg()

	// Report HLS URL to dashboard after FFmpeg starts
	go reportStream()

	// Heartbeat loop
	go func() {
		for {
			sendHeartbeat()
			time.Sleep(HeartbeatSec * time.Second)
		}
	}()

	// Re-report HLS URL every minute so dashboard stays in sync
	go func() {
		for {
			time.Sleep(60 * time.Second)
			reportStream()
		}
	}()

	// Watch FFmpeg and restart if it dies
	go watchFFmpeg()

	// Block forever
	select {}
}

// registerAutostart registers this binary to run on login (platform-specific).
func registerAutostart() {
	exePath, err := os.Executable()
	if err != nil { return }
	switch runtime.GOOS {
	case "windows":
		platformRegisterAutostart(exePath)
	case "darwin":
		plistPath := filepath.Join(os.Getenv("HOME"), "Library", "LaunchAgents", "com.realseccam.streamer.plist")
		if _, err := os.Stat(plistPath); err == nil { return }
		plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>com.realseccam.streamer</string>\n  <key>ProgramArguments</key><array><string>%s</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n</dict></plist>`, exePath)
		os.MkdirAll(filepath.Dir(plistPath), 0755)
		if os.WriteFile(plistPath, []byte(plist), 0644) == nil {
			exec.Command("launchctl", "load", "-w", plistPath).Run()
		}
	default:
		dir := filepath.Join(os.Getenv("HOME"), ".config", "autostart")
		os.MkdirAll(dir, 0755)
		desktopPath := filepath.Join(dir, "realseccam-streamer.desktop")
		if _, err := os.Stat(desktopPath); err == nil { return }
		content := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=RealSecCam Streamer\nExec=%s\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n", exePath)
		os.WriteFile(desktopPath, []byte(content), 0644)
	}
}