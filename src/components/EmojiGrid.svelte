<script lang="ts">
  import { flip } from 'svelte/animate';
  import { resourceImage } from '@hyprgate/utils';
  import type { EmojiListItem } from '../lib/emoji-sets';

  interface Props {
    emojis: EmojiListItem[];
    onremove: (emoji: EmojiListItem) => void;
    onreorder: (fromIndex: number, toIndex: number) => void;
  }

  type DragState = {
    key: string;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
  };

  let { emojis, onremove, onreorder }: Props = $props();
  let drag = $state<DragState | null>(null);
  let paletteElement: HTMLElement | null = null;

  const dragPreviewEmoji = $derived(drag ? emojis.find((emoji) => emoji.key === drag?.key) ?? null : null);

  function emojiLabel(emoji: EmojiListItem): string {
    return emoji.type === 'custom' ? emoji.label : emoji.content;
  }

  function startDrag(event: PointerEvent, emoji: EmojiListItem): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    drag = {
      key: emoji.key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    drag = { ...drag, x: event.clientX, y: event.clientY, active: drag.active || distance > 4 };
    if (!drag.active) return;
    const fromIndex = emojis.findIndex((emoji) => emoji.key === drag?.key);
    const toIndex = insertionIndexFromPoint(event.clientX, event.clientY, drag.key, fromIndex);
    if (fromIndex !== -1 && toIndex !== fromIndex) onreorder(fromIndex, toIndex);
  }

  function finishDrag(event: PointerEvent): void {
    if (drag && event.pointerId !== drag.pointerId) return;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', finishDrag);
    drag = null;
  }

  function insertionIndexFromPoint(clientX: number, clientY: number, draggingKey: string, fromIndex: number): number {
    if (!paletteElement || fromIndex === -1) return fromIndex;
    const chips = Array.from(paletteElement.querySelectorAll<HTMLElement>('[data-emoji-key]'))
      .filter((element) => element.dataset.emojiKey !== draggingKey);
    if (chips.length === 0) return fromIndex;

    let closest: { index: number; distance: number } | null = null;
    for (const chip of chips) {
      const chipIndex = Number(chip.dataset.index);
      if (!Number.isInteger(chipIndex)) continue;
      const rect = chip.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const before = clientY < centerY - rect.height * 0.18
        || (Math.abs(clientY - centerY) <= rect.height * 0.55 && clientX < centerX);
      const insertIndex = before
        ? (fromIndex < chipIndex ? chipIndex - 1 : chipIndex)
        : (fromIndex < chipIndex ? chipIndex : chipIndex + 1);
      const slotX = before ? rect.left : rect.right;
      const slotY = centerY;
      const distance = Math.hypot(clientX - slotX, clientY - slotY);
      if (!closest || distance < closest.distance) closest = { index: insertIndex, distance };
    }

    return Math.max(0, Math.min(closest?.index ?? fromIndex, emojis.length - 1));
  }

  function handleKeydown(event: KeyboardEvent, index: number): void {
    const columns = paletteElement
      ? Math.max(1, Math.floor(paletteElement.clientWidth / 44))
      : 1;
    const target = (() => {
      switch (event.key) {
        case 'ArrowLeft': return index - 1;
        case 'ArrowRight': return index + 1;
        case 'ArrowUp': return index - columns;
        case 'ArrowDown': return index + columns;
        case 'Home': return 0;
        case 'End': return emojis.length - 1;
        default: return index;
      }
    })();
    if (target === index) return;
    event.preventDefault();
    onreorder(index, Math.max(0, Math.min(target, emojis.length - 1)));
  }
</script>

<div class="palette" bind:this={paletteElement} aria-label="Emoji in this list" class:dragging={drag?.active} role="list">
  {#if emojis.length === 0}
    <p class="empty">No emoji yet — pick some from the library to build your quick-react list.</p>
  {:else}
    {#each emojis as emoji, index (emoji.key)}
      <div
        class="chip-wrap"
        class:drag-source={drag?.key === emoji.key}
        data-emoji-key={emoji.key}
        data-index={index}
        animate:flip={{ duration: 140 }}
      >
        <button
          type="button"
          class="chip"
          class:custom={emoji.type === 'custom'}
          title={`Drag ${emojiLabel(emoji)} to reorder`}
          aria-label={`Drag ${emojiLabel(emoji)} to reorder`}
          aria-grabbed={drag?.key === emoji.key && drag.active}
          onpointerdown={(event) => startDrag(event, emoji)}
          onkeydown={(event) => handleKeydown(event, index)}
        >
          {#if emoji.type === 'custom'}
            <img use:resourceImage={emoji.imageUrl} alt="" loading="lazy" />
          {:else}
            <span class="glyph">{emoji.content}</span>
          {/if}
        </button>
        <button
          type="button"
          class="remove"
          title={`Remove ${emojiLabel(emoji)}`}
          aria-label={`Remove ${emojiLabel(emoji)}`}
          onpointerdown={(event) => event.stopPropagation()}
          onclick={() => onremove(emoji)}
        >
          ×
        </button>
      </div>
    {/each}
  {/if}
</div>

{#if drag?.active && dragPreviewEmoji}
  <div
    class="drag-preview"
    class:custom={dragPreviewEmoji.type === 'custom'}
    style={`left: ${drag.x}px; top: ${drag.y}px;`}
    aria-hidden="true"
  >
    {#if dragPreviewEmoji.type === 'custom'}
      <img use:resourceImage={dragPreviewEmoji.imageUrl} alt="" loading="lazy" />
    {:else}
      <span class="glyph">{dragPreviewEmoji.content}</span>
    {/if}
  </div>
{/if}

<style>
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-content: start;
    overflow-y: auto;
    height: 100%;
    min-height: 0;
    padding: 2px;
    touch-action: none;
  }

  .empty {
    margin: auto;
    padding: 16px 8px;
    text-align: center;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    cursor: grab;
    font-size: 22px;
    line-height: 1;
    user-select: none;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease,
      opacity 0.12s ease,
      transform 0.12s ease;
  }

  .chip-wrap {
    position: relative;
    width: 38px;
    height: 38px;
  }

  .chip:hover,
  .chip:focus-visible {
    border-color: var(--hg-accent-cyan, #82d8f7);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--hg-accent-cyan, #82d8f7) 18%, transparent);
  }

  .chip:active {
    cursor: grabbing;
  }

  .dragging .chip {
    cursor: grabbing;
  }

  .chip-wrap.drag-source .chip {
    opacity: 0.28;
    transform: scale(0.94);
    border-style: dashed;
  }

  .chip.custom {
    padding: 4px;
  }

  .chip.custom img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .remove {
    position: absolute;
    top: -7px;
    right: -7px;
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 50%;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.1s ease;
  }

  .chip-wrap:hover .remove,
  .chip-wrap:focus-within .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover,
  .remove:focus-visible {
    color: var(--hg-accent-red, #ff6b6b);
    border-color: var(--hg-accent-red, #ff6b6b);
  }

  .drag-preview {
    position: fixed;
    z-index: 2147483647;
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border: 1px solid var(--hg-accent-cyan, #82d8f7);
    border-radius: 7px;
    background: color-mix(in srgb, var(--hg-surface, #101010) 88%, var(--hg-accent-cyan, #82d8f7));
    box-shadow: 0 12px 26px rgb(0 0 0 / 0.42);
    color: var(--hg-text-primary, #f2efe7);
    font-size: 23px;
    line-height: 1;
    pointer-events: none;
    transform: translate(-50%, -50%) scale(1.06);
  }

  .drag-preview.custom {
    padding: 4px;
  }

  .drag-preview.custom img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip,
    .remove {
      transition: none;
    }
  }
</style>
