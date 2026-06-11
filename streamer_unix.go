//go:build !windows

package main

import "os/exec"

func hiddenCmdPlatform(_ *exec.Cmd) {}
func showNotification()             {}
func platformRegisterAutostart(_ string) {}