import { Matrix4, Vector3, Raycaster } from 'three';

// The custom map layer uses a combined map/world projection, not a Three camera pose.
export function pickBus(point, width, height, projection, objects) {
  if (!width || !height) return null;
  const inverse = new Matrix4().copy(projection).invert();
  const x = point.x / width * 2 - 1, y = 1 - point.y / height * 2;
  const near = new Vector3(x, y, -1).applyMatrix4(inverse);
  const far = new Vector3(x, y, 1).applyMatrix4(inverse);
  const ray = new Raycaster(near, far.sub(near).normalize());
  for (const hit of ray.intersectObjects(objects, true)) {
    if (!hit.object.isMesh) continue;
    for (let object = hit.object; object; object = object.parent) {
      if (object.userData.busId) return object.userData.busId;
    }
  }
  return null;
}
