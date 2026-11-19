import Foundation
import Network
import UIKit
import Capacitor

/// Recibe frases NMEA 0183 de un receptor GPS por WiFi y las pasa a la web.
///
///  · TCP: la app se conecta como cliente a host:puerto (modo más habitual en
///    receptores y pasarelas ESP32/u-blox, p. ej. 192.168.4.1:10110).
///  · UDP: la app escucha en un puerto; el receptor debe enviar a la IP del
///    móvil (unicast). Recibir broadcast/multicast en iOS exige un permiso
///    especial de Apple (com.apple.developer.networking.multicast).
///
/// Eventos hacia JS:
///  · "data"   { chunk: String, t: ms }  texto recibido (líneas NMEA, quizá partidas)
///  · "status" { state, error? }         connecting | ready | waiting | listening | failed | closed | cancelled
@objc(NmeaSocketPlugin)
public class NmeaSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NmeaSocketPlugin"
    public let jsName = "NmeaSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "trackinstructor.nmea.socket")
    private var connection: NWConnection?
    private var listener: NWListener?
    private var udpConnections: [NWConnection] = []
    /// Cada conexión nueva incrementa la generación: los callbacks de una
    /// conexión anterior se ignoran.
    private var generation = 0

    @objc func connect(_ call: CAPPluginCall) {
        guard let portNumber = call.getInt("port"), portNumber > 0, portNumber <= 65535,
              let port = NWEndpoint.Port(rawValue: UInt16(portNumber)) else {
            call.reject("Puerto no válido")
            return
        }
        let proto = (call.getString("protocol") ?? "tcp").lowercased()
        let host = (call.getString("host") ?? "").trimmingCharacters(in: .whitespaces)

        queue.async {
            self.closeAll()
            self.generation += 1
            let gen = self.generation

            if proto == "udp" {
                do {
                    let params = NWParameters.udp
                    params.allowLocalEndpointReuse = true
                    let l = try NWListener(using: params, on: port)
                    l.stateUpdateHandler = { [weak self] state in
                        guard let self = self, gen == self.generation else { return }
                        switch state {
                        case .ready: self.emitStatus("listening")
                        case .failed(let error): self.emitStatus("failed", error)
                        case .cancelled: self.emitStatus("cancelled")
                        default: break
                        }
                    }
                    l.newConnectionHandler = { [weak self] c in
                        guard let self = self, gen == self.generation else { c.cancel(); return }
                        self.udpConnections.append(c)
                        c.start(queue: self.queue)
                        self.receiveUDP(c, gen)
                    }
                    l.start(queue: self.queue)
                    self.listener = l
                    call.resolve()
                } catch {
                    call.reject("No se pudo escuchar en UDP \(portNumber): \(error.localizedDescription)")
                }
                return
            }

            guard !host.isEmpty else {
                call.reject("Falta la IP del receptor")
                return
            }
            let tcp = NWProtocolTCP.Options()
            tcp.noDelay = true
            tcp.enableKeepalive = true
            tcp.keepaliveIdle = 5
            tcp.connectionTimeout = 8
            let params = NWParameters(tls: nil, tcp: tcp)
            params.requiredInterfaceType = .wifi
            let c = NWConnection(host: NWEndpoint.Host(host), port: port, using: params)
            c.stateUpdateHandler = { [weak self] state in
                guard let self = self, gen == self.generation else { return }
                switch state {
                case .preparing: self.emitStatus("connecting")
                case .ready: self.emitStatus("ready")
                case .waiting(let error): self.emitStatus("waiting", error)
                case .failed(let error): self.emitStatus("failed", error)
                case .cancelled: self.emitStatus("cancelled")
                default: break
                }
            }
            c.start(queue: self.queue)
            self.connection = c
            self.receiveTCP(c, gen)
            call.resolve()
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        queue.async {
            self.generation += 1
            self.closeAll()
            call.resolve()
        }
    }

    /// Mantiene la pantalla encendida durante la tanda.
    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }

    private func receiveTCP(_ c: NWConnection, _ gen: Int) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self, gen == self.generation else { return }
            if let data = data, !data.isEmpty { self.emitData(data) }
            if isComplete || error != nil {
                self.emitStatus("closed", error)
                return
            }
            self.receiveTCP(c, gen)
        }
    }

    private func receiveUDP(_ c: NWConnection, _ gen: Int) {
        c.receiveMessage { [weak self] data, _, _, error in
            guard let self = self, gen == self.generation else { return }
            if let data = data, !data.isEmpty { self.emitData(data) }
            if error == nil { self.receiveUDP(c, gen) }
        }
    }

    private func emitData(_ data: Data) {
        let text = String(decoding: data, as: UTF8.self)
        notifyListeners("data", data: ["chunk": text, "t": Date().timeIntervalSince1970 * 1000])
    }

    private func emitStatus(_ state: String, _ error: NWError? = nil) {
        var payload: [String: Any] = ["state": state]
        if let error = error { payload["error"] = error.localizedDescription }
        notifyListeners("status", data: payload)
    }

    private func closeAll() {
        connection?.cancel()
        connection = nil
        listener?.cancel()
        listener = nil
        udpConnections.forEach { $0.cancel() }
        udpConnections.removeAll()
    }

    deinit {
        closeAll()
    }
}
