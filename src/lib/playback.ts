import { useSyncExternalStore } from "react";

/**
 * Only one preview (audio clip or YouTube embed) may sound at a time across the
 * app — starting a new one stops whatever was playing before.
 *
 * Rows also subscribe to the currently sounding key so they can highlight
 * themselves while they play.
 */
let stopCurrent: (() => void) | null = null;

let nowPlayingKey: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function claimPlayback(stop: () => void) {
  if (stopCurrent && stopCurrent !== stop) stopCurrent();
  stopCurrent = stop;
}

export function releasePlayback(stop: () => void) {
  if (stopCurrent === stop) stopCurrent = null;
}

/** Marks a row as the one currently making sound (or clears it). */
export function setNowPlaying(key: string | null | undefined) {
  const next = key ?? null;
  if (nowPlayingKey === next) return;
  nowPlayingKey = next;
  emit();
}

/** Clears the highlight only if this row still owns it. */
export function clearNowPlaying(key: string | null | undefined) {
  if (!key) return;
  if (nowPlayingKey === key) setNowPlaying(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return nowPlayingKey;
}

export function useNowPlaying() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function useIsPlaying(key: string | null | undefined) {
  return useNowPlaying() === (key ?? "\u0000never");
}

/** Shared highlight styling for a row that is currently playing. */
export const playingRowClass =
  "glow-ring text-primary";
