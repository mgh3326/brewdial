<script lang="ts">
  interface Props {
    message: string;
  }
  let { message }: Props = $props();
</script>

<div class="error-panel" role="alert">
  {message}
</div>
