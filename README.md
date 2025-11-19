# Prompt Library

A minimal prompt library you can run locally. Add prompts with a title and content, save them to `localStorage`, and manage them via simple cards.

## Run

Open `index.html` in your browser:

```powershell
cd "c:\workspace\Front End Masters Classes\Practical Prompt Engineering\practical-prompt-engineering-code-exercise"
Start-Process .\index.html
```

Optionally use a dev server (e.g., VS Code Live Server) for auto-reload.

## Features

- Save prompts (title + content) to `localStorage`
- Preview a few words from each prompt’s content
- Delete prompts and re-render instantly
- Clean, modern dark developer theme

## Notes

- All data is stored locally in your browser under key `promptLibrary.prompts.v1`.
- No external dependencies. Pure HTML/CSS/JS.
