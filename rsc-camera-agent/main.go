// RSC Camera Agent — headless webcam publisher for LiveKit
// Compiles to a single .exe with zero dependencies
// Runs as a Windows service or Linux daemon
//
// Usage:
//   rsc-camera-agent.exe                    (foreground mode)
//   rsc-camera-agent.exe -install           (install as Windows service)
//   rsc-camera-agent.exe -uninstall         (remove Windows service)
//   rsc-camera-agent.exe -config agent.json (use custom config path)

package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

const (
	AppName    = "RSCCameraAgent"
	AppVersion = "2.1.0"
	UserAgent  = "RSC-Camera-Agent/" + AppVersion
)

// Config loaded from agent_config.json
type AgentConfig struct {
	CameraID     string `json:"camera_id"`
	Room         string `json:"room"`
	TokenURL     string `json:"token_url"`
	LiveKitURL   string `json:"livekit_url"`
	Identity     string `json:"identity"`
	DeviceName   string `json:"device_name"`
	AppID        string `json:"app_id"`
	ConfigServer string `json:"config_server"`
}

// TokenResponse from VPS token server
type TokenResponse struct {
	Token string `json:"token"`
	URL   string `json:"url"`
	Error string `json:"error,omitempty"`
}

var (
	configPath = flag.String("config", "", "Path to agent_config.json")
	doInstall  = flag.Bool("install", false, "Install as Windows service")
	doRemove   = flag.Bool("uninstall", false, "Remove Windows service")
)

func main() {
	flag.Parse()

	// Windows service install/uninstall
	if *doInstall {
		installService()
		return
	}
	if *doRemove {
		removeService()
		return
	}

	// Detect if running as Windows service
	if runtime.GOOS == "windows" && !isInteractive() {
		runAsWindowsService()
		return
	}

	// Foreground mode
	log.Printf("[RSC] Camera Agent v%s starting (foreground)\n", AppVersion)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle Ctrl+C
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("[RSC] Shutdown signal received")
		cancel()
	}()

	if err := runAgent(ctx); err != nil {
		log.Fatalf("[RSC] Agent error: %v", err)
	}
}

func runAgent(ctx context.Context) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	// Self-register on first run if camera_id is "auto"
	if cfg.CameraID == "auto" && cfg.ConfigServer != "" {
		log.Println("[RSC] First run — auto-registering with server...")
		newCfg, err := autoRegister(cfg)
		if err != nil {
			return fmt.Errorf("auto-register: %w", err)
		}
		cfg = newCfg
		log.Printf("[RSC] ✓ Registered as camera %s", cfg.CameraID)
	}

	log.Printf("[RSC] Camera ID: %s", cfg.CameraID)
	log.Printf("[RSC] Token URL: %s", cfg.TokenURL)
	log.Printf("[RSC] LiveKit:   %s", cfg.LiveKitURL)
	log.Printf("[RSC] Device:    %s", cfg.DeviceName)

	// Main reconnect loop — runs forever
	for {
		select {
		case <-ctx.Done():
			log.Println("[RSC] Context cancelled, shutting down")
			return nil
		default:
		}

		err := publishSession(ctx, cfg)
		if err != nil {
			log.Printf("[RSC] Session ended: %v", err)
		}

		// Wait before reconnecting
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(5 * time.Second):
			log.Println("[RSC] Reconnecting...")
		}
	}
}

func publishSession(ctx context.Context, cfg *AgentConfig) error {
	// Step 1: Get a token from VPS
	token, err := fetchToken(cfg)
	if err != nil {
		return fmt.Errorf("token: %w", err)
	}
	log.Println("[RSC] Token acquired")

	// Step 2: Publish via livekit-cli (bundled or system)
	// We use livekit-cli's publish command which handles all WebRTC complexity
	// This avoids needing CGO for direct webcam capture
	return publishWithCLI(ctx, cfg.LiveKitURL, token)
}

func fetchToken(cfg *AgentConfig) (string, error) {
	payload := map[string]interface{}{
		"room":         cfg.CameraID,
		"identity":     cfg.Identity,
		"canPublish":   true,
		"canSubscribe": false,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", cfg.TokenURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", UserAgent)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("HTTP error: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("token server %d: %s", resp.StatusCode, string(respBody))
	}

	var tokenResp TokenResponse
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return "", fmt.Errorf("parse: %w", err)
	}
	if tokenResp.Error != "" {
		return "", fmt.Errorf("server: %s", tokenResp.Error)
	}
	return tokenResp.Token, nil
}

func publishWithCLI(ctx context.Context, livekitURL, token string) error {
	// Find livekit-cli binary
	cliPath := findLiveKitCLI()
	if cliPath == "" {
		return fmt.Errorf("livekit-cli not found — install it or place it next to this .exe")
	}

	log.Printf("[RSC] Using livekit-cli: %s", cliPath)

	// Build the publish command
	// livekit-cli join-room --url <ws_url> --token <token> --publish-av
	args := []string{
		"room", "join",
		"--url", livekitURL,
		"--token", token,
		"--publish", "av",
	}

	cmd := execCommand(ctx, cliPath, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	log.Printf("[RSC] Publishing: %s %s", cliPath, strings.Join(args, " "))
	err := cmd.Run()
	if ctx.Err() != nil {
		return ctx.Err() // expected shutdown
	}
	return err
}

func findLiveKitCLI() string {
	// Check same directory as this executable
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		candidates := []string{
			filepath.Join(dir, "livekit-cli"),
			filepath.Join(dir, "livekit-cli.exe"),
			filepath.Join(dir, "lk"),
			filepath.Join(dir, "lk.exe"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c
			}
		}
	}

	// Check PATH
	for _, name := range []string{"livekit-cli", "lk"} {
		if p := findInPath(name); p != "" {
			return p
		}
	}

	return ""
}

func findInPath(name string) string {
	pathEnv := os.Getenv("PATH")
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	for _, dir := range filepath.SplitList(pathEnv) {
		p := filepath.Join(dir, name+ext)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func loadConfig() (*AgentConfig, error) {
	path := *configPath
	if path == "" {
		// Default: look next to executable
		exePath, err := os.Executable()
		if err != nil {
			return nil, err
		}
		path = filepath.Join(filepath.Dir(exePath), "agent_config.json")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	var cfg AgentConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	// Defaults
	if cfg.TokenURL == "" {
		cfg.TokenURL = "https://livekit.realsecuritycamera.com/livekit-token"
	}
	if cfg.LiveKitURL == "" {
		cfg.LiveKitURL = "wss://livekit.realsecuritycamera.com"
	}
	if cfg.Identity == "" {
		hostname, _ := os.Hostname()
		cfg.Identity = fmt.Sprintf("agent-%s", hostname)
	}
	if cfg.DeviceName == "" {
		hostname, _ := os.Hostname()
		cfg.DeviceName = hostname
	}
	if cfg.Room == "" && cfg.CameraID != "" && cfg.CameraID != "auto" {
		cfg.Room = cfg.CameraID
	}

	return &cfg, nil
}
