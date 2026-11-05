// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "FileSwitcher",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "FileSwitcher", targets: ["FileSwitcher"])
    ],
    dependencies: [
        // нужны для перехвата: системный TLS-стек не умеет поднимать TLS поверх уже открытого сокета
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.80.0"),
        .package(url: "https://github.com/apple/swift-nio-ssl.git", from: "2.27.0")
    ],
    targets: [
        .executableTarget(
            name: "FileSwitcher",
            dependencies: [
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio"),
                .product(name: "NIOHTTP1", package: "swift-nio"),
                .product(name: "NIOSSL", package: "swift-nio-ssl")
            ]
        ),
        .testTarget(
            name: "FileSwitcherTests",
            dependencies: [
                "FileSwitcher",
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOHTTP1", package: "swift-nio")
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
