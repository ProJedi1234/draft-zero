import Testing
@testable import Draft_Zero

/// Ported from tests/action-voice.test.ts; the web and native echoes must agree.
struct ActionVoiceTests {
    static let doCases: [(String, String)] = [
        ("", ""),
        ("   ", ""),
        ("\n", ""),
        ("\n  \n", ""),
        ("open the cellar door", "You open the cellar door."),
        ("I shove the door with my shoulder", "You shove the door with your shoulder."),
        ("I am not going in there", "You are not going in there."),
        ("I tell her, \"I'm not leaving without my sister\"", "You tell her, \"I'm not leaving without my sister.\""),
        ("i wait", "You wait."),
        ("I was afraid of the dark", "You were afraid of the dark."),
        ("I still am not sure", "You still are not sure."),
        ("I really am done", "You really are done."),
        ("I never was any good at this", "You never were any good at this."),
        ("I run and the guard was there", "You run and the guard was there."),
        ("I HAVE THE KEY", "You HAVE THE KEY."),
        ("I pull myself up", "You pull yourself up."),
        ("I claim what is mine", "You claim what is yours."),
        ("I return to our camp", "You return to your camp."),
        ("I follow the tracks", "You follow the tracks."),
        ("I'd rather not touch it", "You'd rather not touch it."),
        ("I've seen this room before", "You've seen this room before."),
        ("I'll wait here", "You'll wait here."),
        ("I’m ready", "You're ready."),
        ("I’ve been here before", "You've been here before."),
        ("we’re leaving", "You're leaving."),
        ("I climb down into the mine", "You climb down into the mine."),
        ("I climb down into the old flooded mine", "You climb down into the old flooded mine."),
        ("I sweep out my old mine", "You sweep out your old mine."),
        ("the key is mine", "You the key is yours."),
        ("the city will be mine", "You the city will be yours."),
        ("the sword becomes mine", "You the sword becomes yours."),
        ("that makes it mine", "You that makes it yours."),
        ("the horse is a friend of mine", "You the horse is a friend of yours."),
        ("her blade is the same as mine", "You her blade is the same as yours."),
        ("I compare the map with mine", "You compare the map with yours."),
        ("I hand her the coat and grab mine", "You hand her the coat and grab yours."),
        ("the guard drops mine", "You the guard drops mine."),
        ("I say, \"I will find my sister\"", "You say, \"I will find my sister.\""),
        ("I shout “stay back” at the guard", "You shout “stay back” at the guard."),
        ("I run!", "You run!"),
        ("I hesitate…", "You hesitate…"),
        ("I kick a rock feeling bored as I walk through the trees", "You kick a rock feeling bored as you walk through the trees."),
        ("I open the door before I lose my nerve", "You open the door before you lose your nerve."),
        ("I wait until I'm sure the hall is empty", "You wait until you're sure the hall is empty."),
        ("I run because I've seen what it does", "You run because you've seen what it does."),
        ("I duck low and I'll circle around the back", "You duck low and you'll circle around the back."),
        ("I stop, and I'd rather not go further", "You stop, and you'd rather not go further."),
        ("I hide because I’m afraid", "You hide because you're afraid."),
        ("I scream because I'VE HAD ENOUGH", "You scream because YOU'VE HAD ENOUGH."),
        ("do I dare?", "You do you dare?"),
        ("You open the door", "You open the door."),
        ("you open the door", "You open the door."),
        ("I open the door\nand step through", "You open the door and step through."),
        ("the guard turns around", "You the guard turns around."),
        ("the guard hands me the key", "You the guard hands you the key."),
        ("open the door. step inside", "You open the door. step inside."),
        ("I open the door. I step inside", "You open the door. You step inside."),
        ("I freeze! I'm not ready", "You freeze! You're not ready."),
        ("I run. and I hide", "You run. and you hide."),
        ("we run for the door", "You run for the door."),
        ("We run for the door", "You run for the door."),
        ("we brace ourselves", "You brace yourself."),
        ("Us two head for the stairs", "You two head for the stairs."),
        ("the US embassy is burning", "You the US embassy is burning."),
        ("WE ARE LEAVING", "You WE ARE LEAVING."),
    ]

    static let sayCases: [(String, String)] = [
        ("", ""),
        ("   ", ""),
        ("\n", ""),
        ("who's down there?", "You say, \"Who's down there?\""),
        ("i tell her I'm not leaving without my sister", "You say, \"I'm not leaving without my sister.\""),
        ("\"get back\"", "You say, \"Get back.\""),
        ("“hello?”", "You say, \"Hello?\""),
        ("\"\"", ""),
        ("I shout, \"get out of the house\"", "You say, \"Get out of the house.\""),
        ("I say, hello", "You say, \"Hello.\""),
        ("I whisper: don't move", "You say, \"Don't move.\""),
        ("I answer — not tonight", "You say, \"Not tonight.\""),
        ("I reply - not tonight", "You say, \"Not tonight.\""),
        ("I ask her, why did you come back?", "You say, \"Why did you come back?\""),
        ("I tell him that we should leave", "You say, \"We should leave.\""),
        ("I say that we should leave", "You say, \"We should leave.\""),
        ("we ask the guard where the stairs are", "You say, \"Where the stairs are.\""),
        ("I told you so", "You say, \"I told you so.\""),
        ("I said nothing", "You say, \"I said nothing.\""),
        ("i say nothing moved", "You say, \"I say nothing moved.\""),
        ("I answer to no one", "You say, \"I answer to no one.\""),
        ("I call him a liar", "You say, \"A liar.\""),
        ("she called it a \"gift\"", "You say, \"She called it a “gift.”\""),
        ("he said \"no\" and walked out", "You say, \"He said “no” and walked out.\""),
        ("I'm not leaving without my sister", "You say, \"I'm not leaving without my sister.\""),
        ("nobody told me about the cellar", "You say, \"Nobody told me about the cellar.\""),
        ("I shout:", "You say, \"I shout:.\""),
        ("get out!", "You say, \"Get out!\""),
        ("fine…", "You say, \"Fine…\""),
        ("hello\nthere", "You say, \"Hello there.\""),
        ("it’s locked", "You say, \"It’s locked.\""),
        ("I am not going in there", "You say, \"I am not going in there.\""),
        ("my sister is still down there", "You say, \"My sister is still down there.\""),
        ("give me the lamp", "You say, \"Give me the lamp.\""),
        ("I whisper urgently: don't move", "You say, \"Don't move.\""),
        ("I scream at him, run", "You say, \"Run.\""),
    ]

    @Test(arguments: doCases)
    func translatesDo(input: String, expected: String) {
        #expect(ActionVoice.translate(.do, input) == expected)
    }

    @Test(arguments: sayCases)
    func translatesSay(input: String, expected: String) {
        #expect(ActionVoice.translate(.say, input) == expected)
    }

    @Test func reRunningOnItsOwnOutputIsStable() {
        let once = ActionVoice.translate(.do, "I open the cellar door")
        #expect(ActionVoice.translate(.do, once) == once)
    }
}
