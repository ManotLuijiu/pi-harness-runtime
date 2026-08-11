/**
 * Project Bootstrap - RFC-0072
 *
 * Frappe app template
 */

import type { ProjectSpec, Template } from './types.js';

export const frappeTemplate: Template = {
  name: 'frappe-app',
  description: 'Frappe app with modules, doctypes, web pages',
  async apply(spec: ProjectSpec, root: string): Promise<string[]> {
    const { writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');

    const files: string[] = [];
    const appName = spec.name.replace(/[^a-zA-Z0-9_]/g, '_');

    // MANIFEST.json
    const manifest = {
      name: appName,
      app_name: appName,
      app_title: spec.description || spec.name,
      app_publisher: spec.author || 'Author',
      app_email: 'author@example.com',
      app_description: spec.description || '',
      app_version: '0.0.1',
      app_license: spec.license || 'MIT',
      hooks: {},
      doctypes: [],
      fixtures: [],
    };

    await writeFile(join(root, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
    files.push('MANIFEST.json');

    // pyproject.toml
    const pyproject = `[build-system]
requires = ["flit_core >=3.2,<4"]
build-backend = "flit_core.buildapi"

[project]
name = "${appName}"
version = "0.0.1"
description = "${spec.description || ''}"
authors = [{name = "${spec.author || 'Author'}", email = "author@example.com"}]
license = {text = "${spec.license || 'MIT'}"}

[tool.frappe]
app_title = "${spec.name}"
app_publisher = "${spec.author || 'Author'}"
app_email = "author@example.com"
app_description = "${spec.description || ''}"
app_version = "0.0.1"
app_license = "${spec.license || 'MIT'}"
app_modules = []
`;
    await writeFile(join(root, 'pyproject.toml'), pyproject);
    files.push('pyproject.toml');

    // app/__init__.py
    await mkdir(join(root, appName), { recursive: true });
    await writeFile(join(root, appName, '__init__.py'), `__version__ = "0.0.1"\n`);
    files.push(`${appName}/__init__.py`);

    // hooks.py
    const hooksPy = [
      '# App hooks',
      `app_name = "${appName}"`,
      `app_title = "${spec.name}"`,
      `app_publisher = "${spec.author || 'Author'}"`,
      'app_email = "author@example.com"',
      `app_description = "${spec.description || ''}"`,
      'app_version = "0.0.1"',
      `app_license = "${spec.license || 'MIT'}"`,
      '',
      '# hooks',
      'doc_events = {}',
    ].join('\n');

    await writeFile(join(root, appName, 'hooks.py'), hooksPy);
    files.push(`${appName}/hooks.py`);

    // modules.txt (required for Frappe)
    await writeFile(join(root, 'modules.txt'), '');
    files.push('modules.txt');

    // README
    await writeFile(
      join(root, 'README.md'),
      `# ${spec.name}\n\n${spec.description || 'A Frappe app.'}\n`
    );
    files.push('README.md');

    return files;
  },
};
