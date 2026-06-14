//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

var (
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	user32         = syscall.NewLazyDLL("user32.dll")
	getConsoleWin  = kernel32.NewProc("GetConsoleWindow")
	showWindowProc = user32.NewProc("ShowWindow")
	messageBoxProc = user32.NewProc("MessageBoxW")
)

func hideWindow() {
	hwnd, _, _ := getConsoleWin.Call()
	if hwnd != 0 {
		showWindowProc.Call(hwnd, 0)
	}
}

func showError(msg string) {
	hwnd, _, _ := getConsoleWin.Call()
	if hwnd != 0 { showWindowProc.Call(hwnd, 5) }
	title, _ := syscall.UTF16PtrFromString("RSC Camera Agent")
	text, _ := syscall.UTF16PtrFromString(msg)
	messageBoxProc.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x00000010)
}

func showInfo(msg string) {
	title, _ := syscall.UTF16PtrFromString("RSC Camera Agent")
	text, _ := syscall.UTF16PtrFromString(msg)
	messageBoxProc.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x00000040)
}

func promptForCode(prompt string) string {
	hwnd, _, _ := getConsoleWin.Call()
	if hwnd != 0 { showWindowProc.Call(hwnd, 5) }
	fmt.Println("============================================")
	fmt.Println("  RSC Camera Agent - Device Registration")
	fmt.Println("============================================")
	fmt.Println()
	fmt.Println(prompt)
	fmt.Println()
	fmt.Print("  Code: ")
	var code string
	fmt.Scanln(&code)
	if hwnd != 0 { showWindowProc.Call(hwnd, 0) }
	return code
}
