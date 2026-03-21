'use client';

import { createContext, useContext } from 'react';

const FeaturesContext = createContext({});

export function FeaturesProvider({ features, children }) {
  return (
    <FeaturesContext.Provider value={features || {}}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures() {
  return useContext(FeaturesContext);
}
