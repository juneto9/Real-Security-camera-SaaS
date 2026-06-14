// +build !windows

package main

import (
	"context"
	"fmt"
	"log"
	"os/exec"
)

func isInteractive() bool {
	return true
}

func runAsWindowsService() {
	log.Fatal("Windows service mode not available on this platform")
}

func installService() {
	fmt.Println("Windows service install not available on this platform.")
	fmt.Println("Use systemd instead:")
	fmt.Println("")
	fmt.Println("  sudo cp rsc-camera-agent /usr/local/bin/")
	fmt.Println("  sudo cp agent_config.json /etc/rsc/")
	fmt.Println("")
	fmt.Println("Create /etc/systemd/system/rsc-camera-agent.service:")
	fmt.Println("  [Unit]")
	fmt.Println("  Description=RSC Camera Agent")
	fmt.Println("  After=network.target")
	fmt.Println("  [Service]")
	fmt.Println("  ExecStart=/usr/local/bin/rsc-camera-agent -config /etc/rsc/agent_config.json")
	fmt.Println("  Restart=always")
	fmt.Println("  [Install]")
	fmt.Println("  WantedBy=multi-user.target")
	fmt.Println("")
	fmt.Println("Then: sudo systemctl enable --now rsc-camera-agent")
}

func removeService() {
	fmt.Println("To remove on Linux:")
	fmt.Println("  sudo systemctl disable --now rsc-camera-agent")
	fmt.Println("  sudo rm /etc/systemd/system/rsc-camera-agent.service")
	fmt.Println("  sudo rm /usr/local/bin/rsc-camera-agent")
}

func execCommand(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}
