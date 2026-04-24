// Factory name to geographic coordinates mapping
// Using major Indian manufacturing cities
export interface FactoryLocation {
  name: string;
  coordinates: [number, number]; // [longitude, latitude]
  city: string;
}

export const factoryLocations: Record<string, FactoryLocation> = {
  'AutoParts Manufacturing': {
    name: 'AutoParts Manufacturing',
    coordinates: [77.1025, 28.7041], // Delhi
    city: 'Delhi'
  },
  'Precision Components Ltd': {
    name: 'Precision Components Ltd',
    coordinates: [72.8777, 19.0760], // Mumbai
    city: 'Mumbai'
  },
  'Industrial Solutions Inc': {
    name: 'Industrial Solutions Inc',
    coordinates: [77.5946, 12.9716], // Bangalore
    city: 'Bangalore'
  },
  'Tech Manufacturing Co': {
    name: 'Tech Manufacturing Co',
    coordinates: [80.2707, 13.0827], // Chennai
    city: 'Chennai'
  },
  'Advanced Production Systems': {
    name: 'Advanced Production Systems',
    coordinates: [88.3639, 22.5726], // Kolkata
    city: 'Kolkata'
  },
  'Quality Components Inc': {
    name: 'Quality Components Inc',
    coordinates: [78.4867, 17.3850], // Hyderabad
    city: 'Hyderabad'
  },
  'Modern Manufacturing Co': {
    name: 'Modern Manufacturing Co',
    coordinates: [75.8577, 22.7196], // Indore
    city: 'Indore'
  },
  'Elite Production Ltd': {
    name: 'Elite Production Ltd',
    coordinates: [73.8567, 18.5204], // Pune
    city: 'Pune'
  },
  'Innovation Manufacturing': {
    name: 'Innovation Manufacturing',
    coordinates: [72.5714, 23.0225], // Ahmedabad
    city: 'Ahmedabad'
  },
  'Superior Components Co': {
    name: 'Superior Components Co',
    coordinates: [77.4126, 28.6139], // Noida
    city: 'Noida'
  }
};

// Get coordinates for a factory name, with fallback
export function getFactoryCoordinates(factoryName: string): [number, number] {
  const location = factoryLocations[factoryName];
  if (location) {
    return location.coordinates;
  }
  // Fallback to center of India if factory not found
  return [77.1025, 28.7041]; // Delhi
}

// Get city for a factory name
export function getFactoryCity(factoryName: string): string {
  const location = factoryLocations[factoryName];
  return location?.city || 'Unknown';
}
