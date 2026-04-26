# Plan Templates

Ready-made plan files for common project types. Copy a template and customize it
for your project, or use them as-is with `swarm swarm <template>.json`.

| Template | Steps | Agents Used | Estimated Time |
|----------|-------|-------------|----------------|
| [rest-api](rest-api.json) | 4 | worker, reviewer | 8-12 min |
| [react-app](react-app.json) | 5 | worker, reviewer | 10-15 min |
| [cli-tool](cli-tool.json) | 3 | worker, reviewer | 6-10 min |
| [fullstack](fullstack.json) | 6 | worker, reviewer | 15-20 min |
| [library](library.json) | 4 | worker, reviewer | 8-12 min |

## Usage

```bash
# Copy a template to your plans directory
cp templates/rest-api.json plans/my-api.json

# Edit the goal and tasks to fit your project
# Then execute:
swarm swarm plans/my-api.json

# Or run directly (uses the template as-is):
swarm swarm templates/rest-api.json
```

## Customization

Each template is a standard plan JSON file. You can:
- Change the `goal` field to describe your specific project
- Edit step `task` descriptions to match your requirements
- Add or remove steps
- Change agent assignments
- Adjust dependencies between steps
