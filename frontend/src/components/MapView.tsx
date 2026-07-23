import { useEffect, useRef } from "react";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Garante os ícones padrão do Leaflet no bundle do Vite.
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});
import { AddressViabilityResponse, CoverageAreaWithPolygons, GeographicCoordinate } from "../types";

interface Props {
  result: AddressViabilityResponse | null;
  coverageAreas: CoverageAreaWithPolygons[] | null;
  /** Posição atual do marcador do endereço (após ajuste manual, se houver). */
  markerPosition: GeographicCoordinate | null;
  onMarkerAdjusted: (position: GeographicCoordinate) => void;
}

const STATUS_COLOR: Record<string, string> = {
  PRELIMINARILY_VIABLE: "#1a7f4b",
  ADDRESS_AMBIGUOUS: "#b07a10",
  OUTSIDE_COVERAGE: "#b3382f",
  ADDRESS_NOT_FOUND: "#b07a10",
  COVERAGE_NOT_LOADED: "#6b7280",
  GEOCODING_UNAVAILABLE: "#6b7280",
};

const COVERAGE_COLOR = "#0f5c5a";

export default function MapView({ result, coverageAreas, markerPosition, onMarkerAdjusted }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const coverageLayerRef = useRef<L.LayerGroup | null>(null);
  const resultLayerRef = useRef<L.LayerGroup | null>(null);
  const addressMarkerRef = useRef<L.Marker | null>(null);
  const onAdjustRef = useRef(onMarkerAdjusted);
  onAdjustRef.current = onMarkerAdjusted;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([-19.9167, -43.9345], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    coverageLayerRef.current = L.layerGroup().addTo(map);
    resultLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const invalidate = () => map.invalidateSize();
    const timeout = window.setTimeout(invalidate, 0);
    const observer = new ResizeObserver(invalidate);
    observer.observe(containerRef.current);

    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      addressMarkerRef.current = null;
    };
  }, []);

  // Manchas: desenhadas uma vez em camada própria (não recriadas por estado).
  useEffect(() => {
    const map = mapRef.current;
    const layer = coverageLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!coverageAreas || coverageAreas.length === 0) return;

    const bounds = L.latLngBounds([]);
    for (const area of coverageAreas) {
      for (const polygon of area.polygons) {
        const rings: L.LatLngExpression[][] = [
          polygon.outerRing.map((c) => [c.latitude, c.longitude] as [number, number]),
          ...polygon.innerRings.map((ring) =>
            ring.map((c) => [c.latitude, c.longitude] as [number, number])
          ),
        ];
        const shape = L.polygon(rings, {
          color: COVERAGE_COLOR,
          weight: 1.5,
          fillColor: COVERAGE_COLOR,
          fillOpacity: 0.08,
        }).bindTooltip(`Área de cobertura: ${area.name ?? "sem nome"}`);
        shape.addTo(layer);
        bounds.extend(shape.getBounds());
      }
    }
    if (bounds.isValid() && !result) map.fitBounds(bounds.pad(0.1));
  }, [coverageAreas, result]);

  // Marcador do endereço: arrastável para o operador ajustar a localização.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!markerPosition) {
      addressMarkerRef.current?.remove();
      addressMarkerRef.current = null;
      return;
    }

    if (!addressMarkerRef.current) {
      const marker = L.marker([markerPosition.latitude, markerPosition.longitude], {
        draggable: true,
      })
        .bindTooltip("Endereço localizado — arraste para ajustar")
        .addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        onAdjustRef.current({ latitude: lat, longitude: lng });
      });
      addressMarkerRef.current = marker;
    } else {
      addressMarkerRef.current.setLatLng([markerPosition.latitude, markerPosition.longitude]);
    }
    map.setView([markerPosition.latitude, markerPosition.longitude], Math.max(map.getZoom(), 15));
  }, [markerPosition]);

  // Resultado (pontos de rede + linha até o mais próximo) em camada própria.
  useEffect(() => {
    const map = mapRef.current;
    const layer = resultLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!result || !markerPosition) return;

    const accent = STATUS_COLOR[result.status] ?? "#6b7280";
    const { nearestNetworkLocation, alternatives } = result;
    const bounds = L.latLngBounds([[markerPosition.latitude, markerPosition.longitude]]);

    const all = nearestNetworkLocation ? [nearestNetworkLocation, ...alternatives] : alternatives;
    all.forEach((location, index) => {
      const isNearest = index === 0 && nearestNetworkLocation !== null;
      const label =
        location.identificationStatus === "IDENTIFIED"
          ? location.identifiers.map((i) => i.code).join(" · ")
          : "Ponto de rede sem identificação padronizada";
      const marker = L.circleMarker([location.latitude, location.longitude], {
        radius: isNearest ? 9 : 6,
        color: accent,
        fillColor: accent,
        fillOpacity: isNearest ? 0.95 : 0.55,
        weight: isNearest ? 3 : 1.5,
      }).bindTooltip(`${label} · ${location.distanceMeters} m`);
      marker.addTo(layer);
      bounds.extend(marker.getLatLng());
    });

    if (nearestNetworkLocation) {
      L.polyline(
        [
          [markerPosition.latitude, markerPosition.longitude],
          [nearestNetworkLocation.latitude, nearestNetworkLocation.longitude],
        ],
        { color: accent, weight: 2.5, dashArray: "6 6" }
      ).addTo(layer);
      map.fitBounds(bounds.pad(0.35), { maxZoom: 17 });
    }
  }, [result, markerPosition]);

  return (
    <div
      ref={containerRef}
      className="h-[420px] w-full lg:h-full lg:min-h-[600px]"
      aria-label="Mapa de cobertura e pontos de rede"
    />
  );
}
