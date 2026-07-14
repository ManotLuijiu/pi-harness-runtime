# RFC-0065 LARAVEL_PLUGIN

Purpose
- Framework integration

Interface
```ts
export interface FrameworkPlugin{detect(root:string):Promise<boolean>;analyze(root:string):Promise<any>;}
```
