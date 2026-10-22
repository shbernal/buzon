import { defineConfig } from 'charcheck/config'

export default defineConfig({
  rules: [
    {
      id: 'no-em-dash',
      chars: ['—'],
      include: ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/**/*.md', 'skills/**/*.md'],
    },
  ],
})
