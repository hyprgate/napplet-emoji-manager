<script lang="ts">
  interface Props {
    emojis: string[];
    onremove: (emoji: string) => void;
  }

  let { emojis, onremove }: Props = $props();
</script>

<div class="palette" aria-label="Emoji in this list">
  {#if emojis.length === 0}
    <p class="empty">No emoji yet — pick some from the library to build your quick-react list.</p>
  {:else}
    {#each emojis as emoji (emoji)}
      <button
        type="button"
        class="chip"
        title={`Remove ${emoji}`}
        aria-label={`Remove ${emoji}`}
        onclick={() => onremove(emoji)}
      >
        <span class="glyph">{emoji}</span>
        <span class="x">×</span>
      </button>
    {/each}
  {/if}
</div>

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
  }

  .empty {
    margin: auto;
    padding: 16px 8px;
    text-align: center;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }

  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
  }

  .chip:hover {
    border-color: var(--hg-accent-red, #ff6b6b);
  }

  .x {
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
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.1s ease;
  }

  .chip:hover .x,
  .chip:focus-visible .x {
    opacity: 1;
  }

  .chip:hover .x {
    color: var(--hg-accent-red, #ff6b6b);
    border-color: var(--hg-accent-red, #ff6b6b);
  }
</style>
