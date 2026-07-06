export type Marker = {
  id: string;
  label: string;
  time: number;
};

export function sortMarkers(markers: Marker[]) {
  return [...markers].sort((left, right) => left.time - right.time);
}

export function createMarker(
  id: string,
  time: number,
  index: number
): Marker {
  return {
    id,
    label: `Marker ${index + 1}`,
    time
  };
}

export function removeMarker(markers: Marker[], markerId: string) {
  return markers.filter((marker) => marker.id !== markerId);
}

export function findReturnMarker(
  markers: Marker[],
  selectedMarkerId: string | null,
  currentTime: number
) {
  const sortedMarkers = sortMarkers(markers);

  if (sortedMarkers.length === 0) {
    return null;
  }

  const selected = selectedMarkerId
    ? sortedMarkers.find((marker) => marker.id === selectedMarkerId)
    : undefined;

  if (selected) {
    return selected;
  }

  const previousMarker = [...sortedMarkers]
    .reverse()
    .find((marker) => marker.time <= currentTime + 0.1);

  return previousMarker ?? sortedMarkers[0];
}
