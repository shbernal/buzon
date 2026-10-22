# Skills

The agent-facing skill for buzon lives here so it versions with the CLI it describes.

```sh
npx skills add shbernal/buzon
```

| Skill                     | Use it for                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| [`buzon`](buzon/SKILL.md) | Addresses for sign-ups and accounts, verification codes and magic links |

A skill that has drifted from the tool it describes is worse than no skill, so
`tests/skill.test.ts` fails the build when `SKILL.md` names a command or flag the CLI does
not have.
