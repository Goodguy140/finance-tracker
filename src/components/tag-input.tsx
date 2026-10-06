"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { inputClass } from "@/components/forms/shared";
import { MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_TRANSACTION, normalizeTagName } from "@/lib/tags";

export type TagInputHandle = {
  /** Adds names that are not already there: how a rule's tags reach the form. */
  add: (names: readonly string[]) => void;
};

function withNames(current: readonly string[], names: readonly string[]) {
  const next = [...current];
  for (const raw of names) {
    const name = normalizeTagName(raw);
    if (name && !next.some((n) => n.toLowerCase() === name.toLowerCase())) next.push(name);
  }
  return next;
}

/**
 * Tags as removable chips plus a text box that suggests the user's existing tags. Posts one
 * `tags` field per chip, and the box itself is a `tags` field too, so a name typed but not yet
 * turned into a chip is still saved. The server splits on commas and drops empties.
 *
 * Empties when its form resets, as the add forms do after each entry; `defaultTags` (an edit's
 * current tags, or a rule's) only seeds the first render.
 */
export function TagInput({
  defaultTags = [],
  suggestions,
  handleRef,
  label = "Tags",
}: {
  defaultTags?: readonly string[];
  /** The user's tag names. */
  suggestions: readonly string[];
  handleRef?: Ref<TagInputHandle>;
  label?: string;
}) {
  const ids = useId();
  const [tags, setTags] = useState<string[]>(() => [...defaultTags]);
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(handleRef, () => ({ add: (names) => setTags((current) => withNames(current, names)) }), []);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setTags([]);
      setDraft("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function commit() {
    if (!draft.trim()) return;
    setTags((current) => withNames(current, draft.split(",")));
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      // Enter would otherwise submit the whole form with the tag half-typed.
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && tags.length > 0) {
      setTags((current) => current.slice(0, -1));
    }
  }

  const available = suggestions.filter((name) => !tags.some((t) => t.toLowerCase() === name.toLowerCase()));
  const full = tags.length >= MAX_TAGS_PER_TRANSACTION;

  return (
    <div ref={rootRef} className="space-y-1.5" data-testid="tag-input">
      <label htmlFor={`${ids}-input`} className="block text-sm font-medium text-slate-200">
        {label}
      </label>
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected tags">
          {tags.map((tag) => (
            <li
              key={tag.toLowerCase()}
              className="inline-flex items-center gap-1 rounded-full border border-teal-500/40 bg-teal-500/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-teal-100"
            >
              <input type="hidden" name="tags" value={tag} />
              {tag}
              <button
                type="button"
                className="touch-manipulation rounded-full px-1 text-teal-200/80 hover:bg-teal-500/20 hover:text-teal-50"
                aria-label={`Remove tag ${tag}`}
                onClick={() => setTags((current) => current.filter((t) => t !== tag))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={`${ids}-input`}
        name="tags"
        value={draft}
        onChange={(e) => {
          const value = e.target.value;
          // Picking from the suggestion list fires no keystroke; take the pick as a chip
          // straight away instead of leaving it half-entered.
          const picked = !(e.nativeEvent instanceof InputEvent) || e.nativeEvent.inputType === "insertReplacementText";
          if (picked && suggestions.some((name) => name.toLowerCase() === value.trim().toLowerCase())) {
            setTags((current) => withNames(current, [value]));
            setDraft("");
          } else {
            setDraft(value);
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
        list={`${ids}-options`}
        maxLength={MAX_TAG_NAME_LENGTH}
        disabled={full}
        placeholder={full ? `Up to ${MAX_TAGS_PER_TRANSACTION} tags` : "Add a tag, e.g. reimbursable"}
        className={inputClass}
        autoComplete="off"
        enterKeyHint="done"
      />
      <datalist id={`${ids}-options`}>
        {available.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
