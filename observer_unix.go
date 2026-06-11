//go:build !windows

package main

import "os/exec"

// hiddenCmdPlatform is a no-op on macOS/Linux — no console window to hide.
func hiddenCmdPlatform(_ *exec.Cmd) {}

// showInstallNotification is a no-op on macOS/Linux.
func showInstallNotification() {}

// platformRegisterAutostart is a no-op on macOS/Linux (handled in observer.go main switch).
func platformRegisterAutostart(_ string) {}