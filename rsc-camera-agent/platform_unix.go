//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func hideWindow() {} // no-op on non-Windows

func showError(msg string) {
	fmt.Fprintln(os.Stderr, "[ERROR]", msg)
}

func showInfo(msg string) {
	fmt.Fprintln(os.Stdout, "[INFO]", msg)
}

func promptForCode(prompt string) string {
	fmt.Print(prompt + " ")
	reader := bufio.NewReader(os.Stdin)
	code, _ := reader.ReadString('\n')
	return strings.TrimSpace(code)
}
