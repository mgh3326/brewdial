<svelte:head>
  <title>BrewDial</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<main>
  <h1>BrewDial</h1>
  <p class="tagline">
    Coffee recipes, tasting feedback, and dial-in history for agents and humans.
  </p>

  <section>
    <h2>Planned components</h2>
    <ul>
      <li>Mobile recipe viewer</li>
      <li>Feedback capture</li>
      <li>Agent API</li>
      <li>MCP server</li>
      <li>CouchDB document store</li>
    </ul>
  </section>

  <section>
    <h2>Health check</h2>
    <p>
      <a href="/api/health"><code>GET /api/health</code></a>
    </p>
  </section>
</main>

<style>
  main {
    max-width: 540px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 4rem;
  }
  h1 {
    font-size: 2.25rem;
    margin: 0 0 0.5rem;
  }
  .tagline {
    color: #555;
    margin: 0 0 2rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 1.5rem 0 0.5rem;
  }
  ul {
    padding-left: 1.25rem;
    margin: 0;
  }
  li {
    margin: 0.25rem 0;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    background: rgba(0, 0, 0, 0.06);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
  }

  @media (prefers-color-scheme: dark) {
    .tagline {
      color: #aaa;
    }
    code {
      background: rgba(255, 255, 255, 0.08);
    }
  }
</style>
