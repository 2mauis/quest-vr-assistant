//go:build quest_probe

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"
)

func init() {
	parent, err := strconv.Atoi(os.Getenv("QUEST_PROBE_PARENT_PID"))
	lifetime, timeErr := strconv.Atoi(os.Getenv("QUEST_PROBE_LIFETIME_SECONDS"))
	statusFile := os.Getenv("QUEST_PROBE_STATUS_FILE")
	if err != nil || parent <= 1 || os.Getppid() != parent || timeErr != nil || lifetime < 15 || lifetime > 600 || statusFile == "" {
		fmt.Fprintln(os.Stderr, "quest app probe requires a parent, bounded lifetime and private status file")
		os.Exit(2)
	}
	status, _ := json.Marshal(map[string]int{"pid": os.Getpid(), "parent_pid": parent, "uid": os.Getuid()})
	if err := os.WriteFile(statusFile, status, 0600); err != nil {
		fmt.Fprintln(os.Stderr, "quest app probe cannot write private status")
		os.Exit(2)
	}
	// Bound orphan lifetime even if Android kills the Java service without onDestroy.
	go func() {
		deadline := time.NewTimer(time.Duration(lifetime) * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-deadline.C:
				os.Exit(0)
			case <-tick.C:
				if os.Getppid() != parent {
					os.Exit(0)
				}
			}
		}
	}()
}
