export declare const coverageThresholds: {
  provider: 'v8';
  reporter: ('text' | 'html' | 'json-summary')[];
  reportsDirectory: string;
  thresholds: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
};
