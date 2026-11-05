import Foundation
import Testing
@testable import FileSwitcher

/// Разбор тел JSON в дерево для панели деталей
@Suite("Дерево JSON")
struct JSONTreeTests {
    @Test("объект разбирается в отсортированные узлы")
    func objectParsing() throws {
        let nodes = JSONTreeNode.parse(text: "{\"b\":2,\"a\":{\"c\":true}}")
        #expect(nodes.count == 1)
        let root = try #require(nodes.first)
        #expect(root.children.count == 2)
        #expect(root.children[0].label == "a { 1 }")
        #expect(root.children[1].label == "b: 2")
        #expect(root.children[0].children[0].label == "c: true")
    }

    @Test("массив и скаляры получают индексы и читаемые значения")
    func arrayAndScalarParsing() throws {
        let nodes = JSONTreeNode.parse(text: "[1,\"two\",null]")
        let root = try #require(nodes.first)
        #expect(root.children.count == 3)
        #expect(root.children[0].label == "[0]: 1")
        #expect(root.children[1].label == "[1]: \"two\"")
        #expect(root.children[2].label == "[2]: null")
    }

    @Test("обычный текст не считается JSON")
    func plainTextIsNotJSON() {
        #expect(!JSONTreeNode.isJSON("not a json"))
        #expect(JSONTreeNode.isJSON("{\"a\":1}"))
        #expect(JSONTreeNode.parse(text: "not a json").isEmpty)
    }
}
