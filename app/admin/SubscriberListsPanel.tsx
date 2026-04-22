"use client";

import { useState, useRef } from "react";

interface SubscriberList {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  memberCount?: number;
}

export default function SubscriberListsPanel() {
  const [lists, setLists] = useState<SubscriberList[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [feedback, setFeedback] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadLists() {
    try {
      const res = await fetch("/api/admin/subscriber-lists");
      if (!res.ok) {
        setFeedback("Failed to load lists.");
        return;
      }
      const data = await res.json();
      setLists(data ?? []);
    } catch {
      setFeedback("Failed to load lists.");
    }
    setLoaded(true);
  }

  async function createList(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newListName.trim()) {
      setFeedback("List name is required.");
      return;
    }

    setWorking(true);
    try {
      const res = await fetch("/api/admin/subscriber-lists", {
        method: "POST",
        body: JSON.stringify({
          name: newListName.trim(),
          description: newListDesc.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setFeedback(data.error ?? "Failed to create list.");
        setWorking(false);
        return;
      }

      const list = await res.json();
      setLists([list, ...lists]);
      setNewListName("");
      setNewListDesc("");
      setFeedback(`Created list "${list.name}"`);
      window.setTimeout(() => setFeedback(""), 2000);
      inputRef.current?.focus();
    } catch {
      setFeedback("Failed to create list.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteList(id: string, name: string) {
    if (!window.confirm(`Delete list "${name}"? Members won't be removed.`)) return;

    setWorking(true);
    try {
      const res = await fetch(`/api/admin/subscriber-lists/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setFeedback(data.error ?? "Failed to delete list.");
        return;
      }

      setLists(lists.filter((l) => l.id !== id));
      setFeedback(`Deleted list "${name}"`);
      window.setTimeout(() => setFeedback(""), 2000);
    } catch {
      setFeedback("Failed to delete list.");
    } finally {
      setWorking(false);
    }
  }

  if (!loaded) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-200 mb-4">Subscriber Lists</h3>
        <button
          onClick={loadLists}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
        >
          Load Lists
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
      <h3 className="text-lg font-semibold text-zinc-200 mb-4">Subscriber Lists</h3>

      <form onSubmit={createList} className="mb-6 space-y-3 pb-6 border-b border-zinc-800">
        <div>
          <input
            ref={inputRef}
            type="text"
            placeholder="List name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            disabled={working}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <textarea
            placeholder="Description (optional)"
            value={newListDesc}
            onChange={(e) => setNewListDesc(e.target.value)}
            disabled={working}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
            rows={2}
          />
        </div>
        <button
          type="submit"
          disabled={working || !newListName.trim()}
          className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          Create List
        </button>
        {feedback && <p className="text-xs text-amber-300">{feedback}</p>}
      </form>

      <div className="space-y-2">
        {lists.length === 0 ? (
          <p className="text-sm text-zinc-600">No lists yet.</p>
        ) : (
          lists.map((list) => (
            <div key={list.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex-1">
                <p className="font-medium text-zinc-200">{list.name}</p>
                {list.description && <p className="text-xs text-zinc-500 mt-1">{list.description}</p>}
                <p className="text-xs text-zinc-600 mt-1">{list.memberCount ?? 0} member(s)</p>
              </div>
              <button
                onClick={() => deleteList(list.id, list.name)}
                disabled={working}
                className="rounded border border-red-900/80 px-2 py-1 text-xs text-red-300 hover:border-red-700 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
