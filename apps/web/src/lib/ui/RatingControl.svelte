<script lang="ts">
  interface Props {
    name: string;
    label: string;
    min?: number;
    max?: number;
    value?: string;
  }
  let { name, label, min = 0, max = 4, value = undefined }: Props = $props();

  const options = $derived(Array.from({ length: max - min + 1 }, (_, i) => String(min + i)));
</script>

<fieldset class="rating">
  <legend>{label}</legend>
  <div class="rating-options" role="radiogroup" aria-label={label}>
    {#each options as option}
      <label>
        <input
          type="radio"
          {name}
          value={option}
          checked={value === option}
        />
        <span>{option}</span>
      </label>
    {/each}
  </div>
</fieldset>
