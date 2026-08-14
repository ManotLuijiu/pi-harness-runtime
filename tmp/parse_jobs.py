import re, json
with open('/tmp/pi-agent-flow-0nqMtG/tmp/fetch-c796832c8c0f.md') as f:
    raw = f.read()
# Fix markdown-escaped brackets and underscores
fixed = raw.replace('\\ ', ' ')
fixed = fixed.replace('\\[', '[')
fixed = fixed.replace('\\]', ']')
fixed = fixed.replace('\_', '_')
fixed = fixed.replace('\\/', '/')
data = json.loads(fixed)
job = data['jobs'][0]
print('Job name:', job['name'])
print('Job status:', job['status'])
print('Job conclusion:', job['conclusion'])
print('Started at:', job['started_at'])
print('Completed at:', job['completed_at'])
for step in job['steps']:
    c = step.get('conclusion') or step.get('status')
    print(f'  Step {step["number"]}: {step["name"]} - {c}')
