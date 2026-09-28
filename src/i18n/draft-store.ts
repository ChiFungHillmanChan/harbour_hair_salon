'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import { stripLocale } from './paths';

/**
 * Keeps unsaved page state alive across a LANGUAGE SWITCH — and nothing else.
 *
 * Switching language navigates from /x to /zh-hk/x. The `[locale]` root
 * segment changes value, so React remounts the page and every useState,
 * uncontrolled input and useActionState result below it is gone. The JS heap is
 * not: the router performs a soft navigation (same root layout, see
 * is-navigating-to-new-root-layout in next), so a module-level Map survives.
 *
 * Deliberately memory only: nothing here is written to the URL, localStorage,
 * sessionStorage or any cache, so a one-time MFA recovery code or a typed
 * password vanishes on reload, tab close, sign-out or account switch.
 *
 * Restoring is scoped to a switch: an entry is only read back when the
 * language switcher announced a switch for this same page moments ago.
 * Navigating away and returning later starts clean — an old unsaved edit is
 * never silently resurrected into a form someone then saves.
 */
type Entry = { path: string; value: unknown };

const entries = new Map<string, Entry>();
let pendingSwitch: { path: string; expiresAt: number } | null = null;
const SWITCH_WINDOW_MS = 15_000;

/** Called by the language switcher immediately before it navigates. */
export function announceLanguageSwitch(pathname: string) {
  pendingSwitch = { path: stripLocale(pathname), expiresAt: Date.now() + SWITCH_WINDOW_MS };
}

function switchPendingFor(path: string): boolean {
  return pendingSwitch !== null && pendingSwitch.path === path && pendingSwitch.expiresAt > Date.now();
}

/** Read an entry for this page only if a language switch is in progress. */
export function takeDraft<T>(key: string, pathname: string): T | undefined {
  const path = stripLocale(pathname);
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.path !== path || !switchPendingFor(path)) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function saveDraft(key: string, pathname: string, value: unknown) {
  entries.set(key, { path: stripLocale(pathname), value });
}

export function clearDraft(key: string) {
  entries.delete(key);
}

/** Sign-out, sign-in and account switches drop everything. */
export function clearAllDrafts() {
  entries.clear();
  pendingSwitch = null;
}

/**
 * useState that survives a language switch. The setter writes through to the
 * in-memory store synchronously, so nothing is lost between the last
 * keystroke and the navigation.
 */
export function useDraftState<T>(key: string | null, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const pathname = usePathname() ?? '/';
  const [state, setState] = useState<T>(() => {
    if (key) {
      const restored = takeDraft<T>(key, pathname);
      if (restored !== undefined) return restored;
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const latest = useRef(state);
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next;
    latest.current = value;
    if (key) saveDraft(key, pathname, value);
    setState(value);
  }, [key, pathname]);
  // Record the initial value too, so a switch before any edit still restores
  // the same step/selection rather than recomputing it.
  useEffect(() => {
    if (key) saveDraft(key, pathname, latest.current);
  }, [key, pathname]);
  return [state, set];
}

type FieldSnapshot = Record<string, string | string[] | boolean | boolean[]>;

function readForm(form: HTMLFormElement): FieldSnapshot {
  const snapshot: FieldSnapshot = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (!element.name || element.dataset.noPreserve !== undefined) continue;
    if (element instanceof HTMLInputElement && ['hidden', 'file', 'submit', 'button', 'reset'].includes(element.type)) continue;
    const name = element.name;
    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      const list = (snapshot[name] as boolean[] | undefined) ?? [];
      list.push(element.checked);
      snapshot[name] = list;
    } else if (element instanceof HTMLSelectElement && element.multiple) {
      snapshot[name] = Array.from(element.selectedOptions).map((option) => option.value);
    } else {
      const existing = snapshot[name];
      snapshot[name] = existing === undefined ? element.value : [...(Array.isArray(existing) ? existing as string[] : [existing as string]), element.value];
    }
  }
  return snapshot;
}

function writeForm(form: HTMLFormElement, snapshot: FieldSnapshot) {
  const seen = new Map<string, number>();
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    const name = element.name;
    if (!name || !(name in snapshot) || element.dataset.noPreserve !== undefined) continue;
    const index = seen.get(name) ?? 0;
    seen.set(name, index + 1);
    const saved = snapshot[name];
    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      const flags = saved as boolean[];
      if (typeof flags[index] === 'boolean') element.checked = flags[index];
    } else if (element instanceof HTMLSelectElement && element.multiple && Array.isArray(saved)) {
      for (const option of Array.from(element.options)) option.selected = (saved as string[]).includes(option.value);
    } else {
      const value = Array.isArray(saved) ? (saved as string[])[index] : saved;
      if (typeof value === 'string') element.value = value;
    }
  }
}

/**
 * For uncontrolled forms (defaultValue inputs): snapshot every named field on
 * each input/change event and write the snapshot back after a language switch
 * remounts the form. Add `data-no-preserve` to a field to exclude it. Call
 * `clearDraft(key)` after a successful save so the next visit starts clean.
 */
export function usePreservedForm(key: string) {
  const pathname = usePathname() ?? '/';
  const formRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const restored = takeDraft<FieldSnapshot>(key, pathname);
    if (restored) {
      writeForm(form, restored);
      saveDraft(key, pathname, restored);
      // Let dependent widgets (character counters, previews) catch up.
      form.dispatchEvent(new CustomEvent('draft-restored', { bubbles: true }));
    }
    const record = () => saveDraft(key, pathname, readForm(form));
    form.addEventListener('input', record);
    form.addEventListener('change', record);
    return () => {
      form.removeEventListener('input', record);
      form.removeEventListener('change', record);
    };
  }, [key, pathname]);
  return formRef;
}
