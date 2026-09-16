let audioContext: AudioContext | null = null

/** A short synthesised beep — no bundled audio asset needed. */
export function playChime(): void {
  try {
    audioContext ??= new AudioContext()
    const ctx = audioContext
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.18)
  } catch {
    // Audio isn't available in every environment (headless tests, some browsers pre-interaction) — a missed chime is not worth surfacing an error for.
  }
}
