'use client';

import * as React from 'react';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={`rounded-lg border p-4 ${className}`}
      {...props}
    />
  )
);
Alert.displayName = 'Alert';

export interface AlertDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

export const AlertDescription = React.forwardRef<HTMLParagraphElement, AlertDescriptionProps>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`text-sm ${className}`}
      {...props}
    />
  )
);
AlertDescription.displayName = 'AlertDescription';
