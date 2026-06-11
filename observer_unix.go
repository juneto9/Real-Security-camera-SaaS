//go:build !windows

package main

import "os/exec"

func hiddenCmdPlatform(_ *exec.Cmd) {}
func showInstallNotification()      {}
func platformRegisterAutostart(_ string) {}
