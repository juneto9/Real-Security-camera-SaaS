//go:build !windows

package main

import "os/exec"

func hiddenCmdPlatform(_ *exec.Cmd)      {}
func setConsoleTitle(_ string)           {}
func showInstallNotification()           {}
func cleanupOldAgentServices()           {}
func platformRegisterAutostart(_ string) {}
func acquireSingleInstanceMutex() (bool, uintptr) { return true, 0 }
