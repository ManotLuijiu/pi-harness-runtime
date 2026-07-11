# RFC-0046 DEPENDENCY_ANALYZER

Purpose
- Define subsystem

Interface
```ts
export interface Service{run(input:unknown):Promise<unknown>;}
```

Algorithm
1.Validate
2.Execute
3.Emit events
