//go:build quest_probe

// Probe-only adaptation; not an upstream cloudflared feature.
package main

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"os"
	"time"
)

func init() {
	endpoint, err := netip.ParseAddrPort(os.Getenv("QUEST_PROBE_DNS"))
	if err != nil || endpoint.Port() == 0 || endpoint.Addr().IsUnspecified() || endpoint.Addr().IsMulticast() {
		fmt.Fprintln(os.Stderr, "quest probe requires a valid explicit DNS endpoint")
		os.Exit(2)
	}
	address := endpoint.String()
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, address)
		},
	}
}
