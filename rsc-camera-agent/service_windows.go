// +build windows

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

type rscService struct{}

func (s *rscService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (ssec bool, errno uint32) {
	changes <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)

	go func() {
		done <- runAgent(ctx)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case <-done:
				case <-time.After(10 * time.Second):
				}
				return
			case svc.Interrogate:
				changes <- c.CurrentStatus
			}
		case err := <-done:
			if err != nil {
				log.Printf("[RSC] Service agent error: %v", err)
			}
			return
		}
	}
}

func isInteractive() bool {
	interactive, err := svc.IsAnInteractiveSession()
	if err != nil {
		return true // assume interactive on error
	}
	return interactive
}

func runAsWindowsService() {
	elog, err := eventlog.Open(AppName)
	if err == nil {
		defer elog.Close()
		log.SetOutput(&eventLogWriter{elog})
	}

	err = svc.Run(AppName, &rscService{})
	if err != nil {
		log.Fatalf("[RSC] Service failed: %v", err)
	}
}

func installService() {
	exePath, err := os.Executable()
	if err != nil {
		log.Fatalf("Cannot get executable path: %v", err)
	}
	exePath, _ = filepath.Abs(exePath)

	m, err := mgr.Connect()
	if err != nil {
		log.Fatalf("Cannot connect to service manager: %v", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(AppName)
	if err == nil {
		s.Close()
		log.Fatalf("Service %s already exists", AppName)
	}

	s, err = m.CreateService(AppName, exePath, mgr.Config{
		DisplayName: "RSC Camera Agent",
		Description: "Real Security Camera — headless webcam publisher",
		StartType:   mgr.StartAutomatic,
	})
	if err != nil {
		log.Fatalf("Cannot create service: %v", err)
	}
	defer s.Close()

	// Set up event logging
	err = eventlog.InstallAsEventCreate(AppName, eventlog.Error|eventlog.Warning|eventlog.Info)
	if err != nil {
		log.Printf("Warning: could not install event log: %v", err)
	}

	fmt.Printf("Service %s installed successfully.\n", AppName)
	fmt.Println("Start it with: net start RSCCameraAgent")
}

func removeService() {
	m, err := mgr.Connect()
	if err != nil {
		log.Fatalf("Cannot connect to service manager: %v", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(AppName)
	if err != nil {
		log.Fatalf("Service %s not found: %v", AppName, err)
	}
	defer s.Close()

	err = s.Delete()
	if err != nil {
		log.Fatalf("Cannot delete service: %v", err)
	}

	eventlog.Remove(AppName)
	fmt.Printf("Service %s removed successfully.\n", AppName)
}

func execCommand(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

// eventLogWriter adapts Windows Event Log to io.Writer for log package
type eventLogWriter struct {
	elog *eventlog.Log
}

func (w *eventLogWriter) Write(p []byte) (n int, err error) {
	w.elog.Info(1, string(p))
	return len(p), nil
}
