import React, { useState, useEffect, useRef } from 'react';
import { X, ShieldCheck, Copy, Check, Clock } from 'lucide-react';

const EXPIRE_SECONDS = 15 * 60; // 15 minutes

export default function SetupCodeModal({ theme, camera, onClose, onCodeRegistered }) {
  const [code, setCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [remaining, setRemaining] = useState(EXPIRE_SECONDS);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);
  const timerRef = useRef(null);
  const pollRef = useRef(null);

  const accent = theme?.green || '#00ff88';

  // Fetch the registration code from the relay server
  useEffect(() => {
    let cancelled = false;

    const fetchCode = async () => {
      try {
        const res = await fetch('https://livekit.realsecuritycamera.com/register-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            camera_id: camera.id,
            device_name: camera.name,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `Server returned ${res.status}`);
        }

        const data = await res.json();
        if (cancelled) return;

        setCode(data.code);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to get registration code');
        setLoading(false);
      }
    };

    fetchCode();

    return () => { cancelled = true; };
  }, [camera.id, camera.name]);

  // 15-minute countdown
  useEffect(() => {
    if (!code) return;

    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [code]);

  // Poll for the camera going online (agent used the code)
  useEffect(() => {
    if (!code) return;

    pollRef.current = setInterval(async () => {
      try {
        const cameras = await import('@/api/base44Client').then(m => m.base44.entities.Camera.filter({ id: camera.id }));
        const cam = cameras[0];
        if (cam && cam.relay_last_seen) {
          const lastSeen = new Date(cam.relay_last_seen).getTime();
          const recent = Date.now() - lastSeen < 2 * 60 * 1000;
          if (recent) {
            clearInterval(pollRef.current);
            onCodeRegistered?.();
            onClose?.();
          }
        }
      } catch { /* keep polling */ }
    }, 4000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [code, camera.id, onCodeRegistered, onClose]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const s = theme || {};
  const card = s.card || '#141414';
  const border = s.border || '#2a2a2a';
  const text = s.text || '#fff';
  const sub = s.sub || '#888';
  const surface = s.surface || '#0f0f0f';
  const radius = s.radius || 6;

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        backgroundColor: card, border: `1px solid ${border}`,
        borderRadius: 14, width: '100%', maxWidth: 420, position: 'relative',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={20} color={accent} />
            <h2 style={{ fontSize: 17, fontWeight: 700, color: text, margin: 0 }}>
              Set Up Cam Agent
            </h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{
                width: 32, height: 32, border: `3px solid ${border}`, borderTopColor: accent,
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                margin: '0 auto 16px',
              }} />
              <p style={{ color: sub, fontSize: 13 }}>Generating registration code…</p>
            </div>
          )}

          {error && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ color: '#ff3b30', fontSize: 13, marginBottom: 16 }}>
                {error}
              </p>
              <button onClick={onClose} style={{
                padding: '10px 24px', borderRadius: radius,
                backgroundColor: accent, color: '#000', border: 'none',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}>
                Close
              </button>
            </div>
          )}

          {expired && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px',
                backgroundColor: '#ff3b3020', border: '1px solid #ff3b3055',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Clock size={24} color="#ff3b30" />
              </div>
              <h3 style={{ color: '#ff3b30', fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Code Expired</h3>
              <p style={{ color: sub, fontSize: 13, marginBottom: 16 }}>
                This registration code has expired. Request a new one.
              </p>
              <button
                onClick={onClose}
                style={{
                  padding: '10px 24px', borderRadius: radius,
                  backgroundColor: accent, color: '#000', border: 'none',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          )}

          {code && !expired && (
            <>
              <p style={{ fontSize: 13, color: sub, lineHeight: 1.6, marginBottom: 6, textAlign: 'center' }}>
                Enter this code when the agent asks:
              </p>

              {/* Device name */}
              <p style={{ fontSize: 12, color: sub, textAlign: 'center', marginBottom: 16 }}>
                Registering <strong style={{ color: text }}>{camera?.name || 'this device'}</strong>
              </p>

              {/* Code display */}
              <div style={{
                backgroundColor: surface, border: `1px solid ${accent}44`,
                borderRadius: 12, padding: '24px 16px', marginBottom: 16,
                textAlign: 'center',
                boxShadow: `0 0 24px ${accent}22`,
              }}>
                <div style={{
                  fontSize: 56, fontWeight: 800, color: accent, fontFamily: 'var(--font-mono, monospace)',
                  letterSpacing: 12, lineHeight: 1,
                  textShadow: `0 0 20px ${accent}66`,
                  marginBottom: 4,
                }}>
                  {code}
                </div>

                {/* Copy button */}
                <button
                  onClick={handleCopy}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: radius,
                    backgroundColor: copied ? `${accent}22` : `${accent}12`,
                    border: `1px solid ${copied ? accent : `${accent}33`}`,
                    color: copied ? accent : '#aaa', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy Code'}
                </button>
              </div>

              {/* Countdown */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                marginBottom: 8,
              }}>
                <Clock size={14} color={remaining < 60 ? '#ff3b30' : sub} />
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: remaining < 60 ? '#ff3b30' : sub,
                  fontFamily: 'var(--font-mono, monospace)',
                }}>
                  {timeStr}
                </span>
              </div>
              <p style={{ fontSize: 11, color: sub, textAlign: 'center' }}>
                Code expires in 15 minutes. The agent connects automatically after you enter it.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}