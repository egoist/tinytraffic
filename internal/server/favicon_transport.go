package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
)

// Site HTML can point to other hosts. Resolve and dial public IPs directly
// so neither those links nor redirects can access the server's local network.
func faviconTransportForPublicSites() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !faviconPublicIP(ip) {
				return nil, fmt.Errorf("favicon host must have a public IP")
			}
		}
		var dialer net.Dialer
		var lastErr error
		for _, ip := range ips {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		if lastErr == nil {
			lastErr = fmt.Errorf("favicon host has no IP addresses")
		}
		return nil, lastErr
	}
	return transport
}

func faviconPublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsGlobalUnicast() && !ip.IsPrivate() &&
		!netip.MustParsePrefix("100.64.0.0/10").Contains(ip)
}
